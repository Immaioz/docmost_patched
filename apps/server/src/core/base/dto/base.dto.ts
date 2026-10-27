import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PROPERTY_TYPES, VIEW_TYPES } from '../base.types';

export class CreateBaseDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  pageId?: string;

  @IsOptional()
  @IsString()
  spaceId?: string;

  @IsOptional()
  @IsString()
  parentPageId?: string;

  @IsOptional()
  @IsIn(['kanban'])
  template?: 'kanban';
}

export class BasePageDto {
  @IsString()
  pageId: string;
}

export class UpdateBaseDto {
  @IsString()
  pageId: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  icon?: string;
}

export class ConvertBaseDto {
  @IsString()
  pageId: string;

  @IsOptional()
  @IsIn(['kanban'])
  template?: 'kanban';
}

export class ListBasesDto {
  @IsString()
  spaceId: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ExportCsvDto {
  @IsString()
  pageId: string;

  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;
}

export class CreatePropertyDto {
  @IsString()
  pageId: string;

  @IsString()
  name: string;

  @IsIn(PROPERTY_TYPES)
  type: string;

  @IsOptional()
  @IsObject()
  typeOptions?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  requestId?: string;
}

export class UpdatePropertyDto {
  @IsString()
  propertyId: string;

  @IsString()
  pageId: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(PROPERTY_TYPES)
  type?: string;

  @IsOptional()
  @IsObject()
  typeOptions?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  requestId?: string;
}

export class DeletePropertyDto {
  @IsString()
  propertyId: string;

  @IsString()
  pageId: string;

  @IsOptional()
  @IsString()
  requestId?: string;
}

export class ReorderPropertyDto {
  @IsString()
  propertyId: string;

  @IsString()
  pageId: string;

  @IsString()
  position: string;

  @IsOptional()
  @IsString()
  requestId?: string;
}

export class CreateRowDto {
  @IsString()
  pageId: string;

  @IsOptional()
  @IsObject()
  cells?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  afterRowId?: string;

  @IsOptional()
  @IsString()
  position?: string;

  @IsOptional()
  @IsString()
  requestId?: string;
}

export class RowInfoDto {
  @IsString()
  rowId: string;

  @IsString()
  pageId: string;
}

export class UpdateRowDto {
  @IsString()
  rowId: string;

  @IsString()
  pageId: string;

  @IsObject()
  cells: Record<string, unknown>;

  @IsOptional()
  @IsString()
  position?: string;

  @IsOptional()
  @IsString()
  requestId?: string;
}

export class DeleteRowDto {
  @IsString()
  rowId: string;

  @IsString()
  pageId: string;

  @IsOptional()
  @IsString()
  requestId?: string;
}

export class DeleteRowsDto {
  @IsString()
  pageId: string;

  @IsArray()
  @IsString({ each: true })
  rowIds: string[];

  @IsOptional()
  @IsString()
  requestId?: string;
}

export class ReorderRowDto {
  @IsString()
  rowId: string;

  @IsString()
  pageId: string;

  @IsString()
  position: string;

  @IsOptional()
  @IsString()
  requestId?: string;
}

export class ListRowsDto {
  @IsString()
  pageId: string;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsObject()
  filter?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  sorts?: Array<{ propertyId: string; direction: 'asc' | 'desc' }>;
}

export class CreateViewDto {
  @IsString()
  pageId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsIn(VIEW_TYPES)
  type?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateViewDto {
  @IsString()
  viewId: string;

  @IsString()
  pageId: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(VIEW_TYPES)
  type?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  position?: string;
}

export class DeleteViewDto {
  @IsString()
  viewId: string;

  @IsString()
  pageId: string;
}

export class ExpandPagesDto {
  @IsArray()
  @IsString({ each: true })
  pageIds: string[];

  @IsOptional()
  @IsBoolean()
  includeDeleted?: boolean;
}
