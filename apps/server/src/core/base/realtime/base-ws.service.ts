import { Injectable, Logger } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { Server, Socket } from 'socket.io';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { PageAccessService } from '../../page/page-access/page-access.service';

export function baseRoomName(pageId: string): string {
  return `base-${pageId}`;
}

@Injectable()
export class BaseWsService {
  private readonly logger = new Logger(BaseWsService.name);
  private server: Server;

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly userRepo: UserRepo,
    private readonly pageAccessService: PageAccessService,
  ) {}

  setServer(server: Server): void {
    this.server = server;
  }

  isBaseEvent(data: any): boolean {
    return (
      data?.operation === 'base:subscribe' ||
      data?.operation === 'base:unsubscribe'
    );
  }

  async handleInbound(client: Socket, data: any): Promise<void> {
    const pageId = data?.pageId;
    if (typeof pageId !== 'string' || pageId.length === 0) return;

    if (data.operation === 'base:unsubscribe') {
      await client.leave(baseRoomName(pageId));
      return;
    }

    await this.subscribe(client, pageId);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const rooms = [...client.rooms].filter((room) => room.startsWith('base-'));
    for (const room of rooms) {
      await client.leave(room);
    }
  }

  emit(pageId: string, event: Record<string, unknown>): void {
    if (!this.server || !pageId) return;
    this.server.to(baseRoomName(pageId)).emit('message', event);
  }

  async removeUsersFromSpaceBases(
    userIds: string[],
    spaceId: string,
  ): Promise<void> {
    if (!this.server || userIds.length === 0) return;

    try {
      const pages = await this.db
        .selectFrom('pages')
        .select(['id'])
        .where('spaceId', '=', spaceId)
        .where('isBase', '=', true)
        .where('deletedAt', 'is', null)
        .execute();

      const userIdSet = new Set(userIds);

      for (const page of pages) {
        const room = baseRoomName(page.id);
        const sockets = await this.server.in(room).fetchSockets();
        for (const socket of sockets) {
          if (userIdSet.has(socket.data?.userId)) {
            socket.leave(room);
          }
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to remove users from base rooms: ${(err as Error).message}`,
      );
    }
  }

  async removeSubscribersWithoutAccess(pageIds: string[]): Promise<void> {
    if (!this.server || pageIds.length === 0) return;

    try {
      for (const pageId of pageIds) {
        const page = await this.pageRepo.findById(pageId);
        if (!page) continue;

        const room = baseRoomName(pageId);
        const sockets = await this.server.in(room).fetchSockets();

        for (const socket of sockets) {
          const userId = socket.data?.userId;
          const workspaceId = socket.data?.workspaceId;
          if (!userId || page.workspaceId !== workspaceId) {
            socket.leave(room);
            continue;
          }

          try {
            const user = await this.userRepo.findById(userId, workspaceId);
            if (!user) {
              socket.leave(room);
              continue;
            }
            await this.pageAccessService.validateCanView(page, user);
          } catch {
            socket.leave(room);
          }
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to prune base subscribers: ${(err as Error).message}`,
      );
    }
  }

  private async subscribe(client: Socket, pageId: string): Promise<void> {
    const userId = client.data?.userId;
    const workspaceId = client.data?.workspaceId;
    if (!userId || !workspaceId) return;

    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt || !page.isBase) return;
    if (page.workspaceId !== workspaceId) return;

    try {
      const user = await this.userRepo.findById(userId, workspaceId);
      if (!user) return;
      await this.pageAccessService.validateCanView(page, user);
    } catch {
      return;
    }

    await client.join(baseRoomName(pageId));

    const row = await this.db
      .selectFrom('pages')
      .select(['baseSchemaVersion'])
      .where('id', '=', pageId)
      .executeTakeFirst();

    client.emit('message', {
      operation: 'base:subscribed',
      pageId,
      schemaVersion: row?.baseSchemaVersion ?? 0,
    });
  }
}
