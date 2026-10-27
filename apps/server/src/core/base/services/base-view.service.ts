import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import type { BaseView, User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../page/page-access/page-access.service';
import { BaseService } from './base.service';
import { BaseWsService } from '../realtime/base-ws.service';
import {
  CreateViewDto,
  DeleteViewDto,
  UpdateViewDto,
} from '../dto/base.dto';
import { BaseViewType, ViewConfig, mapView } from '../base.types';

@Injectable()
export class BaseViewService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly baseService: BaseService,
    private readonly pageAccessService: PageAccessService,
    private readonly baseWs: BaseWsService,
  ) {}

  async list(pageId: string, user: User) {
    const page = await this.baseService.requireBasePage(pageId);
    await this.pageAccessService.validateCanView(page, user);
    const views = await this.baseService.listViews(pageId);
    return views.map(mapView);
  }

  async create(dto: CreateViewDto, user: User) {
    const page = await this.baseService.requireBasePage(dto.pageId);
    await this.pageAccessService.validateCanEdit(page, user);

    const position = await this.baseService.nextPosition(
      'baseViews',
      page.id,
    );

    const inserted = await this.db
      .insertInto('baseViews')
      .values({
        pageId: page.id,
        name: dto.name,
        type: (dto.type ?? 'table') as string,
        position,
        config: sql`${JSON.stringify(dto.config ?? {})}::text::jsonb` as any,
        workspaceId: page.workspaceId,
        creatorId: user.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    const view = mapView(inserted);
    this.baseWs.emit(page.id, {
      operation: 'base:view:created',
      pageId: page.id,
      view,
    });

    return view;
  }

  async update(dto: UpdateViewDto, user: User) {
    const page = await this.baseService.requireBasePage(dto.pageId);
    await this.pageAccessService.validateCanEdit(page, user);

    const existing = await this.findView(page.id, dto.viewId);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.position !== undefined) patch.position = dto.position;

    if (dto.config !== undefined) {
      const merged = this.mergeConfig(
        (existing.config ?? {}) as ViewConfig,
        dto.config as Record<string, unknown>,
      );
      patch.config = sql`${JSON.stringify(merged)}::text::jsonb`;
    }

    const updated = await this.db
      .updateTable('baseViews')
      .set(patch as any)
      .where('pageId', '=', page.id)
      .where('id', '=', existing.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    const view = mapView(updated);
    this.baseWs.emit(page.id, {
      operation: 'base:view:updated',
      pageId: page.id,
      view,
    });

    return view;
  }

  async delete(dto: DeleteViewDto, user: User): Promise<void> {
    const page = await this.baseService.requireBasePage(dto.pageId);
    await this.pageAccessService.validateCanEdit(page, user);

    const existing = await this.findView(page.id, dto.viewId);

    await this.db
      .deleteFrom('baseViews')
      .where('pageId', '=', page.id)
      .where('id', '=', existing.id)
      .execute();

    this.baseWs.emit(page.id, {
      operation: 'base:view:deleted',
      pageId: page.id,
      viewId: existing.id,
    });
  }

  private async findView(pageId: string, viewId: string): Promise<BaseView> {
    const view = await this.db
      .selectFrom('baseViews')
      .selectAll()
      .where('pageId', '=', pageId)
      .where('id', '=', viewId)
      .executeTakeFirst();

    if (!view) throw new NotFoundException('View not found');
    return view;
  }

  private mergeConfig(
    current: ViewConfig,
    patch: Record<string, unknown>,
  ): ViewConfig {
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) {
        delete next[key];
      } else {
        next[key] = value;
      }
    }
    return next as ViewConfig;
  }
}
