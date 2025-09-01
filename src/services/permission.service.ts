import { DatabaseService } from './database.service';
import { WebClient } from '@slack/web-api';
import { logger } from '../utils/logger';

export class PermissionService {
  private slackClient: WebClient;

  constructor(private databaseService: DatabaseService) {
    this.slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
  }

  async canUserDismiss(userId: string, channelId: string, severity: string): Promise<boolean> {
    try {
      const permissions = await this.databaseService.getUserPermissions(userId, channelId);
      
      switch (severity) {
        case 'low':
          return permissions.canDismissLow || permissions.isAdmin;
        case 'medium':
          return permissions.canDismissMedium || permissions.isAdmin;
        case 'high':
          return permissions.canDismissHigh || permissions.isAdmin;
        case 'critical':
          return permissions.canDismissCritical || permissions.isAdmin;
        default:
          return false;
      }
    } catch (error) {
      logger.error('Error checking user dismissal permissions:', error);
      return false;
    }
  }

  async isUserExempted(userId: string, channelId: string): Promise<boolean> {
    try {
      const config = await this.databaseService.getChannelConfig(channelId);
      return config.exemptedUsers?.includes(userId) || false;
    } catch (error) {
      logger.error('Error checking user exemption:', error);
      return false;
    }
  }

  async isChannelAdmin(userId: string, channelId: string): Promise<boolean> {
    try {
      const permissions = await this.databaseService.getUserPermissions(userId, channelId);
      if (permissions.isAdmin) {
        return true;
      }

      await this.slackClient.conversations.members({
        channel: channelId
      });

      const admins = await this.getChannelAdmins(channelId);
      return admins.includes(userId);
    } catch (error) {
      logger.error('Error checking channel admin status:', error);
      return false;
    }
  }

  private async getChannelAdmins(channelId: string): Promise<string[]> {
    try {
      const channelInfo = await this.slackClient.conversations.info({
        channel: channelId,
        include_num_members: false
      });

      if (!channelInfo.channel) {
        return [];
      }

      const members = await this.slackClient.conversations.members({
        channel: channelId
      });

      if (!members.members) {
        return [];
      }

      const admins: string[] = [];
      
      for (const memberId of members.members) {
        const userInfo = await this.slackClient.users.info({
          user: memberId
        });

        if (userInfo.user?.is_admin || userInfo.user?.is_owner) {
          admins.push(memberId);
        }
      }

      if (channelInfo.channel.creator) {
        admins.push(channelInfo.channel.creator);
      }

      return [...new Set(admins)];
    } catch (error) {
      logger.error('Error getting channel admins:', error);
      return [];
    }
  }

  async grantDismissalPermission(
    userId: string,
    channelId: string,
    severity: string,
    grantedBy: string
  ): Promise<void> {
    try {
      const currentPermissions = await this.databaseService.getUserPermissions(userId, channelId);
      
      const updatedPermissions = { ...currentPermissions };
      
      switch (severity) {
        case 'low':
          updatedPermissions.canDismissLow = true;
          break;
        case 'medium':
          updatedPermissions.canDismissMedium = true;
          break;
        case 'high':
          updatedPermissions.canDismissHigh = true;
          break;
        case 'critical':
          updatedPermissions.canDismissCritical = true;
          break;
      }

      await this.databaseService.setUserPermissions(userId, channelId, updatedPermissions);
      
      logger.info(`Permission granted: ${userId} can now dismiss ${severity} in ${channelId} (granted by ${grantedBy})`);
    } catch (error) {
      logger.error('Error granting dismissal permission:', error);
      throw error;
    }
  }

  async revokeDismissalPermission(
    userId: string,
    channelId: string,
    severity: string,
    revokedBy: string
  ): Promise<void> {
    try {
      const currentPermissions = await this.databaseService.getUserPermissions(userId, channelId);
      
      const updatedPermissions = { ...currentPermissions };
      
      switch (severity) {
        case 'low':
          updatedPermissions.canDismissLow = false;
          break;
        case 'medium':
          updatedPermissions.canDismissMedium = false;
          break;
        case 'high':
          updatedPermissions.canDismissHigh = false;
          break;
        case 'critical':
          updatedPermissions.canDismissCritical = false;
          break;
      }

      await this.databaseService.setUserPermissions(userId, channelId, updatedPermissions);
      
      logger.info(`Permission revoked: ${userId} can no longer dismiss ${severity} in ${channelId} (revoked by ${revokedBy})`);
    } catch (error) {
      logger.error('Error revoking dismissal permission:', error);
      throw error;
    }
  }

  async setAdminStatus(userId: string, channelId: string, isAdmin: boolean, setBy: string): Promise<void> {
    try {
      const currentPermissions = await this.databaseService.getUserPermissions(userId, channelId);
      
      await this.databaseService.setUserPermissions(userId, channelId, {
        ...currentPermissions,
        isAdmin
      });
      
      logger.info(`Admin status ${isAdmin ? 'granted' : 'revoked'}: ${userId} in ${channelId} (by ${setBy})`);
    } catch (error) {
      logger.error('Error setting admin status:', error);
      throw error;
    }
  }
}