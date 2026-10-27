import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import type {
  BaseProperty,
  BaseRow,
  User,
} from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../page/page-access/page-access.service';
import { BaseService } from './base.service';
import { BaseFilterService } from './base-filter.service';
import { BaseWsService } from '../realtime/base-ws.service';
import {
  CreateRowDto,
  DeleteRowDto,
  DeleteRowsDto,
  ListRowsDto,
  ReorderRowDto,
  UpdateRowDto,
} from '../dto/base.dto';
import {
  BaseRowsPage,
  FilterNode,
  ResolvedPage,
  RowReferences,
  UserRef,
  ViewSortConfig,
  decodeOffsetCursor,
  encodeOffsetCursor,
  mapRow,
} from '../base.types';

@Injectable()
export class BaseRowService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly baseService: BaseService,
    private readonly filterService: BaseFilterService,
    private readonly pageAccessService: PageAccessService,
    private readonly baseWs: BaseWsService,
  ) {}

  async create(dto: CreateRowDto, user: User) {
    const page = await this.baseService.requireBasePage(dto.pageId);
    await this.pageAccessService.validateCanEdit(page, user);

    const properties = await this.baseService.listProperties(page.id);
    const cells = this.sanitizeCells(dto.cells ?? {}, properties);

    let position = dto.position;
    if (!position && dto.afterRowId) {
      position = await this.positionAfterRow(page.id, dto.afterRowId);
    }
    if (!position) {
      position = await this.baseService.nextPosition('baseRows', page.id);
    }

    const inserted = await this.db
      .insertInto('baseRows')
      .values({
        pageId: page.id,
        cells: sql`${JSON.stringify(cells)}::text::jsonb` as any,
        position,
        creatorId: user.id,
        lastUpdatedById: user.id,
        workspaceId: page.workspaceId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const row = mapRow(inserted);
    this.baseWs.emit(page.id, {
      operation: 'base:row:created',
      pageId: page.id,
      row,
      requestId: dto.requestId ?? null,
    });

    return row;
  }

  async info(rowId: string, pageId: string, user: User) {
    const page = await this.baseService.requireBasePage(pageId);
    await this.pageAccessService.validateCanView(page, user);

    const row = await this.findRow(page.id, rowId);
    return mapRow(row);
  }

  async update(dto: UpdateRowDto, user: User) {
    const page = await this.baseService.requireBasePage(dto.pageId);
    await this.pageAccessService.validateCanEdit(page, user);

    const existing = await this.findRow(page.id, dto.rowId);
    const properties = await this.baseService.listProperties(page.id);

    const knownIds = new Set(properties.map((property) => property.id));
    const applied: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto.cells ?? {})) {
      if (!knownIds.has(key)) continue;
      applied[key] = value;
    }

    const patch: Record<string, unknown> = {
      // Atomic merge so concurrent collaborators editing different cells
      // cannot overwrite each other with a stale read-modify-write snapshot.
      // A null value deletes the key (see the jsonb_set_many migration helper).
      cells: sql`jsonb_set_many(cells, ${JSON.stringify(applied)}::jsonb)`,
      lastUpdatedById: user.id,
      updatedAt: new Date(),
    };
    if (dto.position !== undefined) patch.position = dto.position;

    const updated = await this.db
      .updateTable('baseRows')
      .set(patch as any)
      .where('pageId', '=', page.id)
      .where('id', '=', existing.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.baseWs.emit(page.id, {
      operation: 'base:row:updated',
      pageId: page.id,
      rowId: existing.id,
      updatedCells: applied,
      requestId: dto.requestId ?? null,
    });

    return mapRow(updated);
  }

  async delete(dto: DeleteRowDto, user: User): Promise<void> {
    const page = await this.baseService.requireBasePage(dto.pageId);
    await this.pageAccessService.validateCanEdit(page, user);

    const existing = await this.findRow(page.id, dto.rowId);

    await this.db
      .updateTable('baseRows')
      .set({ deletedAt: new Date(), updatedAt: new Date() } as any)
      .where('pageId', '=', page.id)
      .where('id', '=', existing.id)
      .execute();

    this.baseWs.emit(page.id, {
      operation: 'base:row:deleted',
      pageId: page.id,
      rowId: existing.id,
      requestId: dto.requestId ?? null,
    });
  }

  async deleteMany(dto: DeleteRowsDto, user: User): Promise<void> {
    const page = await this.baseService.requireBasePage(dto.pageId);
    await this.pageAccessService.validateCanEdit(page, user);

    const rowIds = Array.from(new Set(dto.rowIds ?? [])).filter(Boolean);
    if (rowIds.length === 0) return;

    await this.db
      .updateTable('baseRows')
      .set({ deletedAt: new Date(), updatedAt: new Date() } as any)
      .where('pageId', '=', page.id)
      .where('id', 'in', rowIds)
      .where('deletedAt', 'is', null)
      .execute();

    this.baseWs.emit(page.id, {
      operation: 'base:rows:deleted',
      pageId: page.id,
      rowIds,
      requestId: dto.requestId ?? null,
    });
  }

  async reorder(dto: ReorderRowDto, user: User): Promise<void> {
    const page = await this.baseService.requireBasePage(dto.pageId);
    await this.pageAccessService.validateCanEdit(page, user);

    const existing = await this.findRow(page.id, dto.rowId);

    await this.db
      .updateTable('baseRows')
      .set({ position: dto.position, updatedAt: new Date() } as any)
      .where('pageId', '=', page.id)
      .where('id', '=', existing.id)
      .execute();

    this.baseWs.emit(page.id, {
      operation: 'base:row:reordered',
      pageId: page.id,
      rowId: existing.id,
      position: dto.position,
      requestId: dto.requestId ?? null,
    });
  }

  async list(dto: ListRowsDto, user: User): Promise<BaseRowsPage> {
    const page = await this.baseService.requireBasePage(dto.pageId);
    await this.pageAccessService.validateCanView(page, user);

    const properties = await this.baseService.listProperties(page.id);
    const propertyMap = new Map(
      properties.map((property) => [property.id, property]),
    );

    const limit = dto.limit ?? 50;
    const offset = decodeOffsetCursor(dto.cursor);

    let query = this.db
      .selectFrom('baseRows')
      .selectAll()
      .where('pageId', '=', page.id)
      .where('deletedAt', 'is', null);

    const filter = this.filterService.buildFilter(
      (dto.filter as unknown as FilterNode) ?? undefined,
      propertyMap,
    );
    if (filter) {
      query = query.where(filter);
    }

    for (const order of this.filterService.buildOrderBy(
      dto.sorts as ViewSortConfig[] | undefined,
      propertyMap,
    )) {
      query = query.orderBy(order.expression, order.direction);
    }

    const rows = await query
      .orderBy('position', (ob) => ob.collate('C').asc())
      .orderBy('id', 'asc')
      .limit(limit + 1)
      .offset(offset)
      .execute();

    const hasNextPage = rows.length > limit;
    const items = rows.slice(0, limit).map(mapRow);
    const references = await this.buildReferences(items, properties);

    return {
      items,
      meta: {
        limit,
        hasNextPage,
        hasPrevPage: offset > 0,
        nextCursor: hasNextPage
          ? encodeOffsetCursor(offset + limit)
          : null,
        prevCursor: offset > 0 ? encodeOffsetCursor(Math.max(0, offset - limit)) : null,
      },
      references,
    };
  }

  private async findRow(pageId: string, rowId: string): Promise<BaseRow> {
    const row = await this.db
      .selectFrom('baseRows')
      .selectAll()
      .where('pageId', '=', pageId)
      .where('id', '=', rowId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!row) throw new NotFoundException('Row not found');
    return row;
  }

  private async positionAfterRow(
    pageId: string,
    afterRowId: string,
  ): Promise<string> {
    const after = await this.findRow(pageId, afterRowId);
    const next = await this.db
      .selectFrom('baseRows')
      .select(['position'])
      .where('pageId', '=', pageId)
      .where('deletedAt', 'is', null)
      .where('position', '>', after.position)
      .orderBy('position', (ob) => ob.collate('C').asc())
      .limit(1)
      .executeTakeFirst();

    return generateJitteredKeyBetween(after.position, next?.position ?? null);
  }

  private sanitizeCells(
    cells: Record<string, unknown>,
    properties: BaseProperty[],
  ): Record<string, unknown> {
    const knownIds = new Set(properties.map((property) => property.id));
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(cells)) {
      if (!knownIds.has(key)) continue;
      if (value === null || value === undefined) continue;
      result[key] = value;
    }
    return result;
  }

  private async buildReferences(
    rows: ReturnType<typeof mapRow>[],
    properties: BaseProperty[],
  ): Promise<RowReferences> {
    const personProperties = properties.filter(
      (property) => property.type === 'person',
    );
    const pageProperties = properties.filter(
      (property) => property.type === 'page',
    );

    const userIds = new Set<string>();
    const pageIds = new Set<string>();

    for (const row of rows) {
      for (const property of personProperties) {
        this.collectIds(row.cells[property.id], userIds);
      }
      for (const property of pageProperties) {
        this.collectIds(row.cells[property.id], pageIds);
      }
    }

    const users: Record<string, UserRef> = {};
    if (userIds.size > 0) {
      const userRows = await this.db
        .selectFrom('users')
        .select(['id', 'name', 'avatarUrl'])
        .where('id', 'in', Array.from(userIds))
        .execute();

      for (const userRow of userRows) {
        users[userRow.id] = {
          id: userRow.id,
          name: userRow.name,
          avatarUrl: userRow.avatarUrl,
        };
      }
    }

    const pages: Record<string, ResolvedPage> = {};
    if (pageIds.size > 0) {
      const pageRows = await this.db
        .selectFrom('pages')
        .leftJoin('spaces', 'spaces.id', 'pages.spaceId')
        .select([
          'pages.id',
          'pages.slugId',
          'pages.title',
          'pages.icon',
          'pages.spaceId',
          'spaces.id as space_ref_id',
          'spaces.slug as space_slug',
          'spaces.name as space_name',
        ])
        .where('pages.id', 'in', Array.from(pageIds))
        .where('pages.deletedAt', 'is', null)
        .execute();

      for (const pageRow of pageRows) {
        pages[pageRow.id] = {
          id: pageRow.id,
          slugId: pageRow.slugId,
          title: pageRow.title,
          icon: pageRow.icon,
          spaceId: pageRow.spaceId,
          space: pageRow.space_ref_id
            ? {
                id: pageRow.space_ref_id,
                slug: pageRow.space_slug,
                name: pageRow.space_name,
              }
            : null,
        };
      }
    }

    return { users, pages };
  }

  private collectIds(value: unknown, target: Set<string>): void {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') target.add(item);
        else if (item && typeof item === 'object' && 'id' in (item as any)) {
          target.add(String((item as any).id));
        }
      }
      return;
    }
    if (typeof value === 'string') {
      target.add(value);
    }
  }
}
