import type {
  BaseProperty,
  BaseRow,
  BaseView,
} from '@docmost/db/types/entity.types';

export type BasePropertyType =
  | 'text'
  | 'number'
  | 'select'
  | 'status'
  | 'multiSelect'
  | 'date'
  | 'person'
  | 'file'
  | 'page'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'createdAt'
  | 'lastEditedAt'
  | 'lastEditedBy'
  | 'formula'
  | 'longText';

export type BaseViewType = 'table' | 'kanban' | 'calendar';

export type TypeOptions = Record<string, unknown>;

export type Choice = {
  id: string;
  name: string;
  color: string;
  category?: 'todo' | 'inProgress' | 'complete';
};

export type ViewSortConfig = {
  propertyId: string;
  direction: 'asc' | 'desc';
};

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'ncontains'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'before'
  | 'after'
  | 'onOrBefore'
  | 'onOrAfter'
  | 'any'
  | 'none'
  | 'all'
  | 'isWithin';

export type FilterCondition = {
  propertyId: string;
  op: FilterOperator;
  value?: unknown;
};

export type FilterGroup = {
  op: 'and' | 'or';
  children: Array<FilterCondition | FilterGroup>;
};

export type FilterNode = FilterCondition | FilterGroup;

export type ViewConfig = {
  sorts?: ViewSortConfig[];
  filter?: FilterGroup;
  visiblePropertyIds?: string[];
  hiddenPropertyIds?: string[];
  propertyWidths?: Record<string, number>;
  propertyOrder?: string[];
  groupByPropertyId?: string;
  hiddenChoiceIds?: string[];
  choiceOrder?: string[];
};

export type ViewConfigPatch = {
  [K in keyof ViewConfig]?: ViewConfig[K] | null;
};

export type UserRef = {
  id: string;
  name: string | null;
  avatarUrl: string | null;
};

export type ResolvedPage = {
  id: string;
  slugId: string;
  title: string | null;
  icon: string | null;
  spaceId: string;
  space: { id: string; slug: string; name: string } | null;
};

export type RowReferences = {
  users: Record<string, UserRef>;
  pages: Record<string, ResolvedPage>;
};

export type IBaseProperty = {
  id: string;
  pageId: string;
  name: string;
  type: BasePropertyType;
  position: string;
  typeOptions: TypeOptions;
  pendingType?: BasePropertyType | null;
  pendingTypeOptions?: TypeOptions | null;
  isPrimary: boolean;
  workspaceId: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type IBaseRow = {
  id: string;
  pageId: string;
  cells: Record<string, unknown>;
  position: string;
  creatorId: string | null;
  lastUpdatedById: string | null;
  workspaceId: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type IBaseView = {
  id: string;
  pageId: string;
  name: string;
  type: BaseViewType;
  config: ViewConfig;
  position: string;
  workspaceId: string;
  creatorId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type IBase = {
  id: string;
  slugId: string;
  name: string;
  description?: string;
  icon?: string;
  pageId?: string;
  spaceId: string;
  workspaceId: string;
  creatorId: string;
  properties: IBaseProperty[];
  views: IBaseView[];
  createdAt: Date | string;
  updatedAt: Date | string;
  permissions?: {
    canEdit: boolean;
    hasRestriction: boolean;
  };
  baseSchemaVersion: number;
};

export type UpdatePropertyResult = {
  property: IBaseProperty;
  jobId: string | null;
};

export type BaseRowsPage = {
  items: IBaseRow[];
  meta: {
    limit: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
    nextCursor: string | null;
    prevCursor: string | null;
  };
  references?: RowReferences;
};

export function mapProperty(p: BaseProperty): IBaseProperty {
  return {
    id: p.id,
    pageId: p.pageId,
    name: p.name,
    type: p.type as BasePropertyType,
    position: p.position,
    typeOptions: (p.typeOptions ?? {}) as TypeOptions,
    pendingType: (p.pendingType as BasePropertyType) ?? null,
    pendingTypeOptions: (p.pendingTypeOptions ?? null) as TypeOptions | null,
    isPrimary: p.isPrimary,
    workspaceId: p.workspaceId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function mapRow(r: BaseRow): IBaseRow {
  return {
    id: r.id,
    pageId: r.pageId,
    cells: (r.cells ?? {}) as Record<string, unknown>,
    position: r.position,
    creatorId: r.creatorId,
    lastUpdatedById: r.lastUpdatedById,
    workspaceId: r.workspaceId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function mapView(v: BaseView): IBaseView {
  return {
    id: v.id,
    pageId: v.pageId,
    name: v.name,
    type: v.type as BaseViewType,
    config: (v.config ?? {}) as ViewConfig,
    position: v.position,
    workspaceId: v.workspaceId,
    creatorId: v.creatorId,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

export const PROPERTY_TYPES: BasePropertyType[] = [
  'text',
  'number',
  'select',
  'status',
  'multiSelect',
  'date',
  'person',
  'file',
  'page',
  'checkbox',
  'url',
  'email',
  'createdAt',
  'lastEditedAt',
  'lastEditedBy',
  'formula',
  'longText',
];

export const VIEW_TYPES: BaseViewType[] = ['table', 'kanban', 'calendar'];

export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

export function decodeOffsetCursor(cursor?: string | null): number {
  if (!cursor) return 0;
  try {
    const parsed = Number(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  } catch {
    return 0;
  }
}
