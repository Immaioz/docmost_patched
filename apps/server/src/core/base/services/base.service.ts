import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import type {
  BaseProperty,
  BaseView,
  Page,
  User,
  Workspace,
} from '@docmost/db/types/entity.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PageAccessService } from '../../page/page-access/page-access.service';
import { PageService } from '../../page/services/page.service';
import SpaceAbilityFactory from '../../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../casl/interfaces/space-ability.type';
import { BaseWsService } from '../realtime/base-ws.service';
import { BaseFilterService } from './base-filter.service';
import {
  BaseRowsPage,
  BaseViewType,
  Choice,
  FilterNode,
  IBase,
  IBaseProperty,
  IBaseView,
  ResolvedPage,
  ViewConfig,
  decodeOffsetCursor,
  encodeOffsetCursor,
  mapProperty,
  mapView,
} from '../base.types';
import { CreateBaseDto, ListBasesDto, UpdateBaseDto } from '../dto/base.dto';

export const DEFAULT_KANBAN_CHOICES: Choice[] = [
  { id: 'todo', name: 'Todo', color: 'gray', category: 'todo' },
  {
    id: 'in-progress',
    name: 'In progress',
    color: 'blue',
    category: 'inProgress',
  },
  { id: 'done', name: 'Done', color: 'green', category: 'complete' },
];

@Injectable()
export class BaseService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly pageService: PageService,
    private readonly pageAccessService: PageAccessService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly baseWs: BaseWsService,
    private readonly filterService: BaseFilterService,
  ) {}

  async create(
    dto: CreateBaseDto,
    user: User,
    workspace: Workspace,
  ): Promise<IBase> {
    let spaceId = dto.spaceId;
    let parentPageId: string | undefined;

    if (dto.parentPageId) {
      const parentPage = await this.pageRepo.findById(dto.parentPageId);
      if (
        !parentPage ||
        parentPage.deletedAt ||
        parentPage.workspaceId !== workspace.id
      ) {
        throw new NotFoundException('Parent page not found');
      }
      await this.pageAccessService.validateCanEdit(parentPage, user);
      spaceId = parentPage.spaceId;
      parentPageId = parentPage.id;
    } else {
      if (!spaceId) {
        throw new BadRequestException('spaceId or parentPageId is required');
      }
      await this.pageAccessService.validateCanCreate(spaceId, user);
    }

    const title =
      dto.name ?? (dto.template === 'kanban' ? 'Kanban' : 'Untitled base');

    const page = await this.pageService.create(
      user.id,
      workspace.id,
      {
        title,
        icon: dto.icon,
        spaceId,
        parentPageId,
      },
      undefined,
      true,
    );

    await this.createDefaultSchema(
      page,
      user,
      workspace.id,
      dto.template === 'kanban',
    );

    // Base was created with a placeholder id; re-read so isBase/createdAt match.
    return this.buildBase(page, user);
  }

  async getInfo(pageId: string, user: User): Promise<IBase> {
    const page = await this.requireBasePage(pageId);
    const permissions = await this.pageAccessService.validateCanViewWithPermissions(
      page,
      user,
    );
    return this.buildBase(page, undefined, permissions);
  }

  async update(dto: UpdateBaseDto, user: User): Promise<IBase> {
    const page = await this.requireBasePage(dto.pageId);
    await this.pageAccessService.validateCanEdit(page, user);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.title = dto.name;
    if (dto.icon !== undefined) patch.icon = dto.icon;

    await this.db
      .updateTable('pages')
      .set(patch as any)
      .where('id', '=', page.id)
      .execute();

    const updated = await this.pageRepo.findById(page.id);
    return this.buildBase(updated, user);
  }

  async delete(pageId: string, user: User): Promise<void> {
    const page = await this.requireBasePage(pageId);
    await this.pageAccessService.validateCanEdit(page, user);

    await this.pageService.removePage(page.id, user.id, page.workspaceId);
  }

  async convert(
    pageId: string,
    template: string | undefined,
    user: User,
  ): Promise<IBase> {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    await this.pageAccessService.validateCanEdit(page, user);

    if (!page.isBase) {
      await this.db
        .updateTable('pages')
        .set({ isBase: true } as any)
        .where('id', '=', pageId)
        .execute();
    }

    const properties = await this.listProperties(pageId);
    if (properties.length === 0) {
      await this.createDefaultSchema(
        page,
        user,
        page.workspaceId,
        template === 'kanban',
      );
    }

    const updated = await this.pageRepo.findById(pageId);
    return this.buildBase(updated, user);
  }

  async list(
    dto: ListBasesDto,
    user: User,
  ): Promise<{
    items: IBase[];
    meta: {
      limit: number;
      hasNextPage: boolean;
      hasPrevPage: boolean;
      nextCursor: string | null;
      prevCursor: string | null;
    };
  }> {
    const ability = await this.spaceAbility.createForUser(user, dto.spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    const limit = dto.limit ?? 20;
    const offset = decodeOffsetCursor(dto.cursor);

    const rows = await this.db
      .selectFrom('pages')
      .select(['id'])
      .where('spaceId', '=', dto.spaceId)
      .where('isBase', '=', true)
      .where('deletedAt', 'is', null)
      .orderBy('position', (ob) => ob.collate('C').asc())
      .orderBy('id', 'asc')
      .limit(limit + 1)
      .offset(offset)
      .execute();

    const hasNextPage = rows.length > limit;
    const pageIds = rows.slice(0, limit).map((row) => row.id);
    const items = await this.buildBases(pageIds);

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
    };
  }

  async expandPages(
    pageIds: string[],
    user: User,
  ): Promise<{ items: ResolvedPage[] }> {
    const uniqueIds = Array.from(new Set(pageIds)).filter(Boolean);
    if (uniqueIds.length === 0) return { items: [] };

    const rows = await this.db
      .selectFrom('pages')
      .leftJoin('spaces', 'spaces.id', 'pages.spaceId')
      .select([
        'pages.id',
        'pages.slugId',
        'pages.title',
        'pages.icon',
        'pages.spaceId',
        'pages.workspaceId',
        'pages.deletedAt',
        'spaces.id as space_ref_id',
        'spaces.slug as space_slug',
        'spaces.name as space_name',
      ])
      .where('pages.id', 'in', uniqueIds)
      .where('pages.deletedAt', 'is', null)
      .where('pages.workspaceId', '=', user.workspaceId)
      .execute();

    const items: ResolvedPage[] = [];
    for (const row of rows) {
      const page = await this.pageRepo.findById(row.id);
      if (!page) continue;
      try {
        await this.pageAccessService.validateCanView(page, user);
      } catch {
        continue;
      }
      items.push({
        id: row.id,
        slugId: row.slugId,
        title: row.title,
        icon: row.icon,
        spaceId: row.spaceId,
        space: row.space_ref_id
          ? {
              id: row.space_ref_id,
              slug: row.space_slug,
              name: row.space_name,
            }
          : null,
      });
    }

    return { items };
  }

  async exportCsv(pageId: string, filter: unknown, user: User): Promise<{
    fileName: string;
    content: string;
  }> {
    const page = await this.requireBasePage(pageId);
    await this.pageAccessService.validateCanView(page, user);

    const properties = await this.listProperties(pageId);
    const propertyMap = new Map(
      properties.map((property) => [property.id, property]),
    );

    let query = this.db
      .selectFrom('baseRows')
      .select(['cells', 'position', 'id'])
      .where('pageId', '=', pageId)
      .where('deletedAt', 'is', null);

    const where = this.filterService.buildFilter(
      (filter as FilterNode | undefined) ?? undefined,
      propertyMap,
    );
    if (where) {
      query = query.where(where);
    }

    const rows = await query
      .orderBy('position', (ob) => ob.collate('C').asc())
      .orderBy('id', 'asc')
      .execute();

    const header = properties.map((property) => property.name);
    const lines = [header.map((value) => this.csvCell(value)).join(',')];

    for (const row of rows) {
      const cells = (row.cells ?? {}) as Record<string, unknown>;
      lines.push(
        properties
          .map((property) =>
            this.csvCell(
              this.formatCell(
                this.displayCell(property, cells[property.id]),
              ),
            ),
          )
          .join(','),
      );
    }

    const safeName = (page.title || 'base')
      .replace(/[^\w\-. ]+/g, '')
      .trim() || 'base';

    return {
      fileName: `${safeName}.csv`,
      content: lines.join('\r\n'),
    };
  }

  async requireBasePage(pageId: string): Promise<Page> {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt || !page.isBase) {
      throw new NotFoundException('Base not found');
    }
    return page;
  }

  async listProperties(pageId: string): Promise<BaseProperty[]> {
    return this.db
      .selectFrom('baseProperties')
      .selectAll()
      .where('pageId', '=', pageId)
      .where('deletedAt', 'is', null)
      .orderBy('position', (ob) => ob.collate('C').asc())
      .orderBy('id', 'asc')
      .execute();
  }

  async listViews(pageId: string): Promise<BaseView[]> {
    return this.db
      .selectFrom('baseViews')
      .selectAll()
      .where('pageId', '=', pageId)
      .orderBy('position', (ob) => ob.collate('C').asc())
      .orderBy('id', 'asc')
      .execute();
  }

  async getSchemaVersion(pageId: string): Promise<number> {
    const row = await this.db
      .selectFrom('pages')
      .select(['baseSchemaVersion'])
      .where('id', '=', pageId)
      .executeTakeFirst();
    return row?.baseSchemaVersion ?? 0;
  }

  async bumpSchema(pageId: string): Promise<number> {
    const row = await this.db
      .updateTable('pages')
      .set((eb) => ({
        baseSchemaVersion: eb('baseSchemaVersion', '+', 1),
      }))
      .where('id', '=', pageId)
      .returning(['baseSchemaVersion'])
      .executeTakeFirst();

    const schemaVersion = row?.baseSchemaVersion ?? 0;
    this.baseWs.emit(pageId, {
      operation: 'base:schema:bumped',
      pageId,
      schemaVersion,
    });
    return schemaVersion;
  }

  async nextPosition(
    table: 'baseProperties' | 'baseRows' | 'baseViews',
    pageId: string,
  ): Promise<string> {
    const row = await this.db
      .selectFrom(table)
      .select(['position'])
      .where('pageId', '=', pageId)
      .orderBy('position', (ob) => ob.collate('C').desc())
      .limit(1)
      .executeTakeFirst();

    return generateJitteredKeyBetween(row?.position ?? null, null);
  }

  async buildBases(pageIds: string[]): Promise<IBase[]> {
    if (pageIds.length === 0) return [];

    const pages = await this.db
      .selectFrom('pages')
      .select([
        'id',
        'slugId',
        'title',
        'icon',
        'spaceId',
        'workspaceId',
        'creatorId',
        'createdAt',
        'updatedAt',
        'baseSchemaVersion',
      ])
      .where('id', 'in', pageIds)
      .execute();

    const [properties, views] = await Promise.all([
      this.db
        .selectFrom('baseProperties')
        .selectAll()
        .where('pageId', 'in', pageIds)
        .where('deletedAt', 'is', null)
        .orderBy('position', (ob) => ob.collate('C').asc())
        .execute(),
      this.db
        .selectFrom('baseViews')
        .selectAll()
        .where('pageId', 'in', pageIds)
        .orderBy('position', (ob) => ob.collate('C').asc())
        .execute(),
    ]);

    const byPage = new Map<string, { properties: BaseProperty[]; views: BaseView[] }>();
    for (const id of pageIds) byPage.set(id, { properties: [], views: [] });
    for (const property of properties) {
      byPage.get(property.pageId)?.properties.push(property);
    }
    for (const view of views) {
      byPage.get(view.pageId)?.views.push(view);
    }

    const pageById = new Map(pages.map((page) => [page.id, page]));

    return pageIds
      .map((id) => pageById.get(id))
      .filter((page): page is Page => !!page)
      .map((page) => {
        const group = byPage.get(page.id);
        return this.toBase(page, group?.properties ?? [], group?.views ?? []);
      });
  }

  private async buildBase(
    page: Page,
    user?: User,
    permissions?: { canEdit: boolean; hasRestriction: boolean },
  ): Promise<IBase> {
    const [properties, views, schemaVersion] = await Promise.all([
      this.listProperties(page.id),
      this.listViews(page.id),
      this.getSchemaVersion(page.id),
    ]);

    const base = this.toBase(page, properties, views, permissions);
    base.baseSchemaVersion = schemaVersion;

    if (!base.permissions && user) {
      const resolved =
        await this.pageAccessService.validateCanViewWithPermissions(page, user);
      base.permissions = resolved;
    }

    return base;
  }

  private toBase(
    page: Page,
    properties: BaseProperty[],
    views: BaseView[],
    permissions?: { canEdit: boolean; hasRestriction: boolean },
  ): IBase {
    return {
      id: page.id,
      slugId: page.slugId,
      name: page.title ?? '',
      icon: page.icon ?? undefined,
      pageId: page.id,
      spaceId: page.spaceId,
      workspaceId: page.workspaceId,
      creatorId: page.creatorId,
      properties: properties.map(mapProperty) as IBaseProperty[],
      views: views.map(mapView) as IBaseView[],
      createdAt: page.createdAt,
      updatedAt: page.updatedAt,
      permissions,
      baseSchemaVersion: (page as any).baseSchemaVersion ?? 0,
    };
  }

  private async createDefaultSchema(
    page: Page,
    user: User,
    workspaceId: string,
    kanban: boolean,
  ): Promise<void> {
    let position = generateJitteredKeyBetween(null, null);
    const namePropertyId = randomUUID();

    await this.db
      .insertInto('baseProperties')
      .values({
        id: namePropertyId,
        pageId: page.id,
        name: 'Name',
        type: 'text',
        position,
        typeOptions: sql`${JSON.stringify({
          defaultValue: null,
        })}::text::jsonb` as any,
        isPrimary: true,
        workspaceId,
      })
      .execute();

    let groupByPropertyId: string | undefined;

    if (kanban) {
      const statusPropertyId = randomUUID();
      position = generateJitteredKeyBetween(position, null);
      await this.db
        .insertInto('baseProperties')
        .values({
          id: statusPropertyId,
          pageId: page.id,
          name: 'Status',
          type: 'status',
          position,
          typeOptions: sql`${JSON.stringify({
            choices: DEFAULT_KANBAN_CHOICES,
            choiceOrder: DEFAULT_KANBAN_CHOICES.map((choice) => choice.id),
          })}::text::jsonb` as any,
          isPrimary: false,
          workspaceId,
        })
        .execute();
      groupByPropertyId = statusPropertyId;
    }

    const viewPosition = generateJitteredKeyBetween(null, null);
    const viewType: BaseViewType = kanban ? 'kanban' : 'table';
    const config: ViewConfig = kanban
      ? { groupByPropertyId }
      : {};

    await this.db
      .insertInto('baseViews')
      .values({
        pageId: page.id,
        name: kanban ? 'Kanban' : 'Table',
        type: viewType,
        position: viewPosition,
        config: sql`${JSON.stringify(config)}::text::jsonb` as any,
        workspaceId,
        creatorId: user.id,
      })
      .execute();
  }

  private displayCell(property: BaseProperty, value: unknown): unknown {
    if (value === null || value === undefined) return value;

    if (
      property.type === 'select' ||
      property.type === 'status' ||
      property.type === 'multiSelect'
    ) {
      const choices = (
        (property.typeOptions ?? {}) as { choices?: Choice[] }
      ).choices;
      if (Array.isArray(choices) && choices.length > 0) {
        const labels = new Map(choices.map((c) => [c.id, c.name]));
        if (Array.isArray(value)) {
          return value.map((item) => labels.get(String(item)) ?? item);
        }
        return labels.get(String(value)) ?? value;
      }
    }

    return value;
  }

  private formatCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) {
      return value.map((item) => this.formatCell(item)).join(', ');
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  private csvCell(value: string): string {
    if (/[",\r\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
