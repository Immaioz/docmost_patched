import { Module } from '@nestjs/common';
import { PageModule } from '../page/page.module';
import { BaseController } from './base.controller';
import { BaseFilterService } from './services/base-filter.service';
import { BasePropertyService } from './services/base-property.service';
import { BaseRowService } from './services/base-row.service';
import { BaseService } from './services/base.service';
import { BaseViewService } from './services/base-view.service';
import { BaseWsService } from './realtime/base-ws.service';

@Module({
  imports: [PageModule],
  controllers: [BaseController],
  providers: [
    BaseService,
    BasePropertyService,
    BaseViewService,
    BaseRowService,
    BaseFilterService,
    BaseWsService,
  ],
  exports: [BaseService, BaseWsService],
})
export class BaseModule {}
