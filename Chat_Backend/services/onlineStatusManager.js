import { cleanupOfflineUsersService } from '../services/user.service.js';
import { getIO } from '../sockets/init.socket.js';

class OnlineStatusManager {
  constructor() {
    this.cleanupInterval = null;
    this.isRunning = false;
  }

  // Bắt đầu cleanup định kỳ
  startScheduledCleanup(intervalMinutes = 5) {
    if (this.isRunning) {
      console.log('Scheduled cleanup already running');
      return;
    }

    console.log(`Starting scheduled cleanup every ${intervalMinutes} minutes`);
    this.isRunning = true;

    this.cleanupInterval = setInterval(async () => {
      try {
        const result = await cleanupOfflineUsersService(5); // 5 minutes threshold

        if (result.count > 0) {
          console.log(`Scheduled cleanup: ${result.count} users marked offline`);

          // Emit socket events
          const io = getIO();
          if (io) {
            result.cleanedUsers.forEach(userId => {
              io.emit('userOffline', {
                userId: userId,
                lastActive: new Date(),
                reason: 'scheduled_cleanup'
              });
            });
          }
        }
      } catch (error) {
        console.error('Scheduled cleanup error:', error);
      }
    }, intervalMinutes * 60 * 1000); // Convert to milliseconds
  }

  // Dừng cleanup định kỳ
  stopScheduledCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      this.isRunning = false;
      console.log('Scheduled cleanup stopped');
    }
  }

  // Cleanup thủ công
  async manualCleanup(thresholdMinutes = 5) {
    try {
      console.log(`Manual cleanup with ${thresholdMinutes} minutes threshold`);
      const result = await cleanupOfflineUsersService(thresholdMinutes);

      // Emit socket events
      const io = getIO();
      if (io && result.count > 0) {
        result.cleanedUsers.forEach(userId => {
          io.emit('userOffline', {
            userId: userId,
            lastActive: new Date(),
            reason: 'manual_cleanup'
          });
        });
      }

      return result;
    } catch (error) {
      console.error('Manual cleanup error:', error);
      throw error;
    }
  }

  // Lấy thống kê online status
  async getStats() {
    try {
      const { default: User } = await import('../models/User.js');

      const totalUsers = await User.countDocuments();
      const onlineUsers = await User.countDocuments({ onlineStatus: true });
      const offlineUsers = totalUsers - onlineUsers;

      const recentActivity = await User.find({ onlineStatus: true })
        .select('lv001 name lastActive')
        .sort({ lastActive: -1 })
        .limit(5);

      return {
        total: totalUsers,
        online: onlineUsers,
        offline: offlineUsers,
        recentActivity: recentActivity
      };
    } catch (error) {
      console.error('Error getting stats:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const onlineStatusManager = new OnlineStatusManager();
export default onlineStatusManager;
