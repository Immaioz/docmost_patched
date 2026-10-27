import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { randomUUID } from 'crypto';
import { sql, SqlBool } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import type { BaseProperty, User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../page/page-access/page-access.service';
import { BaseService } from './base.service';
import { BaseWsService } from '../realtime/base-ws.service';
import {
  CreatePropertyDto,
  DeletePropertyDto,
  ReorderPropertyDto,
  UpdatePropertyDto,
} from '../dto/base.dto';
import {
  BasePropertyType,
  TypeOptions,
  UpdatePropertyResult,
  mapProperty,
} from '../base.types';

@Injectable()
export class BasePropertyService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly baseService: BaseService,
    private readonly pageAccessService: PageAccessService,
    private readonly baseWs: BaseWsService,
  ) {}

  async create(dto: CreatePropertyDto, user: User) {
    const page = await this.baseService.requireBasePage(dto.pageId);
    await this.pageAccessService.validateCanEdit(page, user);

    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Property name is required');

    await this.assertNameAvailable(page.id, name);

    const existing = await this.baseService.listProperties(page.id);
    const position = await this.baseService.nextPosition(
      'baseProperties',
      page.id,
    );

    const inserted = await this.db
      .insertInto('baseProperties')
      .values({
        id: randomUUID(),
        pageId: page.id,
        name,
        type: dto.type,
        position,
        typeOptions: sql`${JSON.stringify(
          dto.typeOptions ?? {},
        )}::text::jsonb` as any,
        isPrimary: existing.length === 0,
        workspaceId: page.workspaceId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.baseService.bumpSchema(page.id);

    const property = mapProperty(inserted);
    this.baseWs.emit(page.id, {
      operation: 'base:property:created',
      pageId: page.id,
      property,
      requestId: dto.requestId ?? null,
    });

    return property;
  }

  async update(dto: UpdatePropertyDto, user: User): Promise<UpdatePropertyResult> {
    const page = await this.baseService.requireBasePage(dto.pageId);
    await this.pageAccessService.validateCanEdit(page, user);

    const existing = await this.findProperty(page.id, dto.propertyId);

    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Property name is required');
      await this.assertNameAvailable(page.id, name, existing.id);
      patch.name = name;
    }

    if (dto.type !== undefined && dto.type !== existing.type) {
      patch.type = dto.type;
      patch.pendingType = null;
      patch.pendingTypeOptions = null;
      patch.pendingToken = null;
      patch.schemaVersion = sql`schema_version + 1`;
    }

    if (dto.typeOptions !== undefined) {
      patch.typeOptions = sql`${JSON.stringify(
        dto.typeOptions,
      )}::text::jsonb`;
    }

    const updated = await this.db
      .updateTable('baseProperties')
      .set(patch as any)
      .where('pageId', '=', page.id)
      .where('id', '=', existing.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.baseService.bumpSchema(page.id);

    const property = mapProperty(updated);
    this.baseWs.emit(page.id, {
      operation: 'base:property:updated',
      pageId: page.id,
      property,
      requestId: dto.requestId ?? null,
    });

    return { property, jobId: null };
  }

  async delete(dto: DeletePropertyDto, user: User): Promise<void> {
    const page = await this.baseService.requireBasePage(dto.pageId);
    await this.pageAccessService.validateCanEdit(page, user);

    const existing = await this.findProperty(page.id, dto.propertyId);

    await this.db
      .updateTable('baseProperties')
      .set({ deletedAt: new Date(), updatedAt: new Date() } as any)
      .where('pageId', '=', page.id)
      .where('id', '=', existing.id)
      .execute();

    await this.db
      .updateTable('baseRows')
      .set({
        cells: sql`(coalesce(cells, '{}'::jsonb) - ${existing.id}::text)`,
      } as any)
      .where('pageId', '=', page.id)
      .where('deletedAt', 'is', null)
      .execute();

    await this.baseService.bumpSchema(page.id);

    this.baseWs.emit(page.id, {
      operation: 'base:property:deleted',
      pageId: page.id,
      propertyId: existing.id,
      requestId: dto.requestId ?? null,
    });
  }

  async reorder(dto: ReorderPropertyDto, user: User): Promise<void> {
    const page = await this.baseService.requireBasePage(dto.pageId);
    await this.pageAccessService.validateCanEdit(page, user);

    const existing = await this.findProperty(page.id, dto.propertyId);

    await this.db
      .updateTable('baseProperties')
      .set({ position: dto.position, updatedAt: new Date() } as any)
      .where('pageId', '=', page.id)
      .where('id', '=', existing.id)
      .execute();

    await this.baseService.bumpSchema(page.id);

    this.baseWs.emit(page.id, {
      operation: 'base:property:reordered',
      pageId: page.id,
      propertyId: existing.id,
      requestId: dto.requestId ?? null,
    });
  }

  private async findProperty(
    pageId: string,
    propertyId: string,
  ): Promise<BaseProperty> {
    const property = await this.db
      .selectFrom('baseProperties')
      .selectAll()
      .where('pageId', '=', pageId)
      .where('id', '=', propertyId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  private async assertNameAvailable(
    pageId: string,
    name: string,
    ignoreId?: string,
  ): Promise<void> {
    const duplicate = await this.db
      .selectFrom('baseProperties')
      .select(['id'])
      .where('pageId', '=', pageId)
      .where('deletedAt', 'is', null)
      .where(
        sql<SqlBool>`lower(trim(base_properties.name)) = lower(trim(${name}))`,
      )
      .$if(!!ignoreId, (qb) => qb.where('id', '!=', ignoreId))
      .executeTakeFirst();

    if (duplicate) {
      throw new ConflictException('A property with this name already exists');
    }
  }
}
