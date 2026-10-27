import { Injectable } from '@nestjs/common';
import { RawBuilder, SqlBool, sql } from 'kysely';
import type { BaseProperty } from '@docmost/db/types/entity.types';
import {
  FilterCondition,
  FilterGroup,
  FilterNode,
  FilterOperator,
  ViewSortConfig,
} from '../base.types';

type DateBounds = { start: Date; end: Date };

const ARRAY_TYPES = new Set(['multiSelect', 'person', 'page', 'file']);

@Injectable()
export class BaseFilterService {
  buildFilter(
    node: FilterNode | undefined,
    properties: Map<string, BaseProperty>,
  ): RawBuilder<SqlBool> | null {
    if (!node) return null;

    if (this.isGroup(node)) {
      const parts = node.children
        .map((child) => this.buildFilter(child, properties))
        .filter((part): part is RawBuilder<SqlBool> => !!part);

      if (parts.length === 0) return null;

      let combined = parts[0];
      for (let i = 1; i < parts.length; i++) {
        combined =
          node.op === 'or'
            ? sql<SqlBool>`(${combined} OR ${parts[i]})`
            : sql<SqlBool>`(${combined} AND ${parts[i]})`;
      }
      return combined;
    }

    return this.buildCondition(node, properties);
  }

  buildOrderBy(
    sorts: ViewSortConfig[] | undefined,
    properties: Map<string, BaseProperty>,
  ): Array<{ expression: RawBuilder<any>; direction: 'asc' | 'desc' }> {
    const order: Array<{
      expression: RawBuilder<any>;
      direction: 'asc' | 'desc';
    }> = [];

    for (const sort of sorts ?? []) {
      const property = properties.get(sort.propertyId);
      if (!property) continue;
      order.push({
        expression: this.sortExpression(property),
        direction: sort.direction === 'desc' ? 'desc' : 'asc',
      });
    }

    return order;
  }

  private isGroup(node: FilterNode): node is FilterGroup {
    return (
      typeof node === 'object' &&
      node !== null &&
      'children' in node &&
      Array.isArray((node as FilterGroup).children)
    );
  }

  private buildCondition(
    condition: FilterCondition,
    properties: Map<string, BaseProperty>,
  ): RawBuilder<SqlBool> | null {
    const property = properties.get(condition.propertyId);
    if (!property) return null;

    const op = condition.op;
    if (!op) return null;

    if (op === 'isEmpty') {
      return sql<SqlBool>`(${this.emptyExpression(property)})`;
    }
    if (op === 'isNotEmpty') {
      return sql<SqlBool>`NOT (${this.emptyExpression(property)})`;
    }

    if (ARRAY_TYPES.has(property.type)) {
      return this.arrayCondition(property, op, condition.value);
    }

    switch (property.type) {
      case 'number':
        return this.numberCondition(property, op, condition.value);
      case 'date':
      case 'createdAt':
      case 'lastEditedAt':
        return this.dateCondition(property, op, condition.value);
      case 'checkbox': {
        if (op !== 'eq' && op !== 'neq') return null;
        const expected = condition.value === true || condition.value === 'true';
        const expr = sql`${this.boolExpression(property)} = ${expected}`;
        return op === 'eq'
          ? sql<SqlBool>`${expr}`
          : sql<SqlBool>`(${this.boolExpression(property)} IS NULL OR NOT (${expr}))`;
      }
      case 'select':
      case 'status':
      case 'lastEditedBy':
        return this.choiceCondition(property, op, condition.value);
      default:
        return this.textCondition(property, op, condition.value);
    }
  }

  private choiceCondition(
    property: BaseProperty,
    op: FilterOperator,
    value: unknown,
  ): RawBuilder<SqlBool> | null {
    const expr = this.textExpression(property);
    const ids = this.toStringArray(value);

    if (op === 'eq') {
      if (ids.length === 0) return sql<SqlBool>`(${expr} IS NULL)`;
      return sql<SqlBool>`${expr} = ${ids[0]}`;
    }
    if (op === 'neq') {
      if (ids.length === 0) return sql<SqlBool>`(${expr} IS NOT NULL)`;
      return sql<SqlBool>`(${expr} IS NULL OR ${expr} <> ${ids[0]})`;
    }
    if (op === 'any') {
      if (ids.length === 0) return sql<SqlBool>`FALSE`;
      return sql<SqlBool>`${expr} = ANY(${ids}::text[])`;
    }
    if (op === 'none') {
      if (ids.length === 0) return sql<SqlBool>`TRUE`;
      return sql<SqlBool>`(${expr} IS NULL OR NOT (${expr} = ANY(${ids}::text[])))`;
    }
    return null;
  }

  private textCondition(
    property: BaseProperty,
    op: FilterOperator,
    value: unknown,
  ): RawBuilder<SqlBool> | null {
    const expr = this.textExpression(property);
    const text = value === null || value === undefined ? null : String(value);

    switch (op) {
      case 'eq':
        return sql<SqlBool>`${expr} = ${text}`;
      case 'neq':
        return sql<SqlBool>`(${expr} IS NULL OR ${expr} <> ${text})`;
      case 'contains':
        return sql<SqlBool>`${expr} ILIKE ${`%${this.escapeLike(text)}%`}`;
      case 'ncontains':
        return sql<SqlBool>`(${expr} IS NULL OR ${expr} NOT ILIKE ${`%${this.escapeLike(text)}%`})`;
      case 'startsWith':
        return sql<SqlBool>`${expr} ILIKE ${`${this.escapeLike(text)}%`}`;
      case 'endsWith':
        return sql<SqlBool>`${expr} ILIKE ${`%${this.escapeLike(text)}`}`;
      case 'gt':
        return sql<SqlBool>`${expr} > ${text}`;
      case 'gte':
        return sql<SqlBool>`${expr} >= ${text}`;
      case 'lt':
        return sql<SqlBool>`${expr} < ${text}`;
      case 'lte':
        return sql<SqlBool>`${expr} <= ${text}`;
      default:
        return null;
    }
  }

  private numberCondition(
    property: BaseProperty,
    op: FilterOperator,
    value: unknown,
  ): RawBuilder<SqlBool> | null {
    const expr = this.numberExpression(property);
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return null;

    switch (op) {
      case 'eq':
        return sql<SqlBool>`${expr} = ${num}`;
      case 'neq':
        return sql<SqlBool>`(${expr} IS NULL OR ${expr} <> ${num})`;
      case 'gt':
        return sql<SqlBool>`${expr} > ${num}`;
      case 'gte':
        return sql<SqlBool>`${expr} >= ${num}`;
      case 'lt':
        return sql<SqlBool>`${expr} < ${num}`;
      case 'lte':
        return sql<SqlBool>`${expr} <= ${num}`;
      default:
        return null;
    }
  }

  private dateCondition(
    property: BaseProperty,
    op: FilterOperator,
    value: unknown,
  ): RawBuilder<SqlBool> | null {
    const expr = this.dateExpression(property);
    const bounds = this.resolveDateBounds(value, op === 'isWithin');
    if (!bounds) return null;

    const { start, end } = bounds;

    switch (op) {
      case 'isWithin':
      case 'eq':
        return sql<SqlBool>`${expr} >= ${start.toISOString()} AND ${expr} <= ${end.toISOString()}`;
      case 'neq':
        return sql<SqlBool>`(${expr} IS NULL OR ${expr} < ${start.toISOString()} OR ${expr} > ${end.toISOString()})`;
      case 'before':
        return sql<SqlBool>`${expr} < ${start.toISOString()}`;
      case 'after':
        return sql<SqlBool>`${expr} > ${end.toISOString()}`;
      case 'onOrBefore':
        return sql<SqlBool>`${expr} <= ${end.toISOString()}`;
      case 'onOrAfter':
        return sql<SqlBool>`${expr} >= ${start.toISOString()}`;
      default:
        return null;
    }
  }

  private arrayCondition(
    property: BaseProperty,
    op: FilterOperator,
    value: unknown,
  ): RawBuilder<SqlBool> | null {
    const ids = this.toStringArray(value);
    const arr = this.arrayExpression(property);

    if (op === 'eq') {
      if (ids.length === 0) return sql<SqlBool>`FALSE`;
      return sql<SqlBool>`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${arr}) AS e WHERE e = ${ids[0]})`;
    }

    if (op === 'any') {
      if (ids.length === 0) return sql<SqlBool>`FALSE`;
      return sql<SqlBool>`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${arr}) AS e WHERE e = ANY(${ids}::text[]))`;
    }

    if (op === 'none') {
      if (ids.length === 0) return sql<SqlBool>`TRUE`;
      return sql<SqlBool>`NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(${arr}) AS e WHERE e = ANY(${ids}::text[]))`;
    }

    if (op === 'all') {
      if (ids.length === 0) return sql<SqlBool>`TRUE`;
      return sql<SqlBool>`${arr} @> ${JSON.stringify(ids)}::jsonb`;
    }

    if (op === 'neq') {
      if (ids.length === 0) return sql<SqlBool>`TRUE`;
      return sql<SqlBool>`NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(${arr}) AS e WHERE e = ${ids[0]})`;
    }

    return null;
  }

  private emptyExpression(property: BaseProperty): RawBuilder<SqlBool> {
    if (ARRAY_TYPES.has(property.type)) {
      const arr = this.arrayExpression(property);
      return sql<SqlBool>`(jsonb_array_length(${arr}) = 0)`;
    }
    if (property.type === 'number') {
      return sql<SqlBool>`(${this.numberExpression(property)} IS NULL)`;
    }
    if (
      property.type === 'date' ||
      property.type === 'createdAt' ||
      property.type === 'lastEditedAt'
    ) {
      return sql<SqlBool>`(${this.dateExpression(property)} IS NULL)`;
    }
    if (property.type === 'checkbox') {
      return sql<SqlBool>`(${this.boolExpression(property)} IS NULL)`;
    }
    const text = this.textExpression(property);
    return sql<SqlBool>`(${text} IS NULL OR ${text} = '')`;
  }

  private sortExpression(property: BaseProperty): RawBuilder<any> {
    switch (property.type) {
      case 'number':
        return this.numberExpression(property);
      case 'date':
      case 'createdAt':
      case 'lastEditedAt':
        return this.dateExpression(property);
      case 'checkbox':
        return this.boolExpression(property);
      default:
        return this.textExpression(property);
    }
  }

  private textExpression(property: BaseProperty): RawBuilder<any> {
    const prop = property.id;
    switch (property.type) {
      case 'createdAt':
        return sql`base_rows.created_at`;
      case 'lastEditedAt':
        return sql`base_rows.updated_at`;
      case 'lastEditedBy':
        return sql`base_rows.last_updated_by_id::text`;
      default:
        return sql`base_cell_text(base_rows.cells, ${prop})`;
    }
  }

  private numberExpression(property: BaseProperty): RawBuilder<any> {
    return sql`base_cell_numeric(base_rows.cells, ${property.id})`;
  }

  private dateExpression(property: BaseProperty): RawBuilder<any> {
    switch (property.type) {
      case 'createdAt':
        return sql`base_rows.created_at`;
      case 'lastEditedAt':
        return sql`base_rows.updated_at`;
      default:
        return sql`base_cell_timestamptz(base_rows.cells, ${property.id})`;
    }
  }

  private boolExpression(property: BaseProperty): RawBuilder<any> {
    return sql`base_cell_bool(base_rows.cells, ${property.id})`;
  }

  private arrayExpression(property: BaseProperty): RawBuilder<any> {
    const raw = sql`base_cell_array(base_rows.cells, ${property.id})`;
    return sql`(CASE
      WHEN ${raw} IS NULL THEN '[]'::jsonb
      WHEN jsonb_typeof(${raw}) = 'array' THEN ${raw}
      ELSE jsonb_build_array(${raw})
    END)`;
  }

  private toStringArray(value: unknown): string[] {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.map((item) => String(item));
    return [String(value)];
  }

  private escapeLike(value: string | null): string {
    if (value === null) return '';
    return value.replace(/[\\%_]/g, (match) => `\\${match}`);
  }

  private resolveDateBounds(
    value: unknown,
    dayWide: boolean,
  ): DateBounds | null {
    if (value === null || value === undefined) return null;

    if (value instanceof Date) {
      return this.dayRange(value);
    }

    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      return dayWide ? this.dayRange(date) : { start: date, end: date };
    }

    if (typeof value === 'object') {
      const mode = (value as any).mode;

      if (mode === 'exact') {
        const date = new Date((value as any).date);
        if (Number.isNaN(date.getTime())) return null;
        return this.dayRange(date);
      }

      if (mode === 'relative') {
        const preset = (value as any).preset as string;
        const anchor = this.relativeAnchor(preset);
        if (!anchor) return null;
        return this.dayRange(anchor);
      }

      if (mode === 'range') {
        return this.rangeBounds((value as any).preset as string);
      }
    }

    return null;
  }

  private relativeAnchor(preset: string): Date | null {
    const now = new Date();
    switch (preset) {
      case 'today':
        return now;
      case 'tomorrow':
        return this.addDays(now, 1);
      case 'yesterday':
        return this.addDays(now, -1);
      case 'oneWeekAgo':
        return this.addDays(now, -7);
      case 'oneWeekFromNow':
        return this.addDays(now, 7);
      case 'oneMonthAgo':
        return this.addMonths(now, -1);
      case 'oneMonthFromNow':
        return this.addMonths(now, 1);
      default:
        return null;
    }
  }

  private rangeBounds(preset: string): DateBounds | null {
    const now = new Date();

    switch (preset) {
      case 'pastWeek':
        return { start: this.addDays(now, -7), end: now };
      case 'pastMonth':
        return { start: this.addMonths(now, -1), end: now };
      case 'pastYear':
        return { start: this.addYears(now, -1), end: now };
      case 'thisWeek': {
        const start = this.startOfWeek(now);
        return { start, end: this.addDays(start, 6) };
      }
      case 'thisMonth': {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { start: this.startOfDay(start), end: this.endOfDay(end) };
      }
      case 'thisYear': {
        const start = new Date(now.getFullYear(), 0, 1);
        const end = new Date(now.getFullYear(), 11, 31);
        return { start: this.startOfDay(start), end: this.endOfDay(end) };
      }
      case 'nextWeek': {
        const start = this.addDays(this.startOfWeek(now), 7);
        return { start, end: this.addDays(start, 6) };
      }
      case 'nextMonth': {
        const start = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);
        return { start: this.startOfDay(start), end: this.endOfDay(end) };
      }
      case 'nextYear': {
        const start = new Date(now.getFullYear() + 1, 0, 1);
        const end = new Date(now.getFullYear() + 1, 11, 31);
        return { start: this.startOfDay(start), end: this.endOfDay(end) };
      }
      default:
        return null;
    }
  }

  private dayRange(date: Date): DateBounds {
    return { start: this.startOfDay(date), end: this.endOfDay(date) };
  }

  private startOfDay(date: Date): Date {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  private endOfDay(date: Date): Date {
    const copy = new Date(date);
    copy.setHours(23, 59, 59, 999);
    return copy;
  }

  private startOfWeek(date: Date): Date {
    const copy = this.startOfDay(date);
    const day = copy.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    return this.addDays(copy, diff);
  }

  private addDays(date: Date, days: number): Date {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  private addMonths(date: Date, months: number): Date {
    const copy = new Date(date);
    copy.setMonth(copy.getMonth() + months);
    return copy;
  }

  private addYears(date: Date, years: number): Date {
    const copy = new Date(date);
    copy.setFullYear(copy.getFullYear() + years);
    return copy;
  }
}
