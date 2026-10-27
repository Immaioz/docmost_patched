import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import type { User, Workspace } from '@docmost/db/types/entity.types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import { BaseService } from './services/base.service';
import { BasePropertyService } from './services/base-property.service';
import { BaseRowService } from './services/base-row.service';
import { BaseViewService } from './services/base-view.service';
import {
  BasePageDto,
  ConvertBaseDto,
  CreateBaseDto,
  CreatePropertyDto,
  CreateRowDto,
  CreateViewDto,
  DeletePropertyDto,
  DeleteRowDto,
  DeleteRowsDto,
  DeleteViewDto,
  ExpandPagesDto,
  ExportCsvDto,
  ListBasesDto,
  ListRowsDto,
  ReorderPropertyDto,
  ReorderRowDto,
  RowInfoDto,
  UpdateBaseDto,
  UpdatePropertyDto,
  UpdateRowDto,
  UpdateViewDto,
} from './dto/base.dto';

@UseGuards(JwtAuthGuard)
@Controller('bases')
export class BaseController {
  constructor(
    private readonly baseService: BaseService,
    private readonly propertyService: BasePropertyService,
    private readonly rowService: BaseRowService,
    private readonly viewService: BaseViewService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async create(
    @Body() dto: CreateBaseDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.baseService.create(dto, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Post('info')
  async info(@Body() dto: BasePageDto, @AuthUser() user: User) {
    return this.baseService.getInfo(dto.pageId, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async update(@Body() dto: UpdateBaseDto, @AuthUser() user: User) {
    return this.baseService.update(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async delete(@Body() dto: BasePageDto, @AuthUser() user: User) {
    await this.baseService.delete(dto.pageId, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('convert')
  async convert(@Body() dto: ConvertBaseDto, @AuthUser() user: User) {
    return this.baseService.convert(dto.pageId, dto.template, user);
  }

  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @Post('export-csv')
  async exportCsv(
    @Body() dto: ExportCsvDto,
    @AuthUser() user: User,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const { fileName, content } = await this.baseService.exportCsv(
      dto.pageId,
      dto.filter,
      user,
    );

    const encoded = encodeURIComponent(fileName);
    res.header('Content-Type', 'text/csv; charset=utf-8');
    res.header(
      'Content-Disposition',
      `attachment; filename="${fileName}"; filename*=UTF-8''${encoded}`,
    );

    return content;
  }

  @HttpCode(HttpStatus.OK)
  @Post('pages/expand')
  async expandPages(@Body() dto: ExpandPagesDto, @AuthUser() user: User) {
    return this.baseService.expandPages(dto.pageIds, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post()
  async list(@Body() dto: ListBasesDto, @AuthUser() user: User) {
    return this.baseService.list(dto, user);
  }

  // --- Properties ---

  @HttpCode(HttpStatus.OK)
  @Post('properties/create')
  async createProperty(
    @Body() dto: CreatePropertyDto,
    @AuthUser() user: User,
  ) {
    return this.propertyService.create(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('properties/update')
  async updateProperty(
    @Body() dto: UpdatePropertyDto,
    @AuthUser() user: User,
  ) {
    return this.propertyService.update(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('properties/delete')
  async deleteProperty(
    @Body() dto: DeletePropertyDto,
    @AuthUser() user: User,
  ) {
    await this.propertyService.delete(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('properties/reorder')
  async reorderProperty(
    @Body() dto: ReorderPropertyDto,
    @AuthUser() user: User,
  ) {
    await this.propertyService.reorder(dto, user);
  }

  // --- Rows ---

  @HttpCode(HttpStatus.OK)
  @Post('rows/create')
  async createRow(@Body() dto: CreateRowDto, @AuthUser() user: User) {
    return this.rowService.create(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('rows/info')
  async rowInfo(@Body() dto: RowInfoDto, @AuthUser() user: User) {
    return this.rowService.info(dto.rowId, dto.pageId, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('rows/update')
  async updateRow(@Body() dto: UpdateRowDto, @AuthUser() user: User) {
    return this.rowService.update(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('rows/delete')
  async deleteRow(@Body() dto: DeleteRowDto, @AuthUser() user: User) {
    await this.rowService.delete(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('rows/delete-many')
  async deleteRows(@Body() dto: DeleteRowsDto, @AuthUser() user: User) {
    await this.rowService.deleteMany(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('rows/reorder')
  async reorderRow(@Body() dto: ReorderRowDto, @AuthUser() user: User) {
    await this.rowService.reorder(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('rows')
  async listRows(@Body() dto: ListRowsDto, @AuthUser() user: User) {
    return this.rowService.list(dto, user);
  }

  // --- Views ---

  @HttpCode(HttpStatus.OK)
  @Post('views/create')
  async createView(@Body() dto: CreateViewDto, @AuthUser() user: User) {
    return this.viewService.create(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('views/update')
  async updateView(@Body() dto: UpdateViewDto, @AuthUser() user: User) {
    return this.viewService.update(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('views/delete')
  async deleteView(@Body() dto: DeleteViewDto, @AuthUser() user: User) {
    await this.viewService.delete(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('views')
  async listViews(@Body() dto: BasePageDto, @AuthUser() user: User) {
    return this.viewService.list(dto.pageId, user);
  }
}
