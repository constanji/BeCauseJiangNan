/**
 * DAT Database Connection
 * 
 * 连接到独立的 DAT 数据库（用于项目管理等功能）
 * 使用 DAT_MONGO_URI 环境变量
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { logger } = require('@because/data-schemas');

const DAT_MONGO_URI = process.env.DAT_MONGO_URI;

let datConnection = null;
let connectionPromise = null;

/**
 * 获取 DAT 数据库连接
 * @returns {Promise<mongoose.Connection>}
 */
async function getDatConnection() {
    // 如果已有活跃连接，直接返回
    if (datConnection && datConnection.readyState === 1) {
        return datConnection;
    }

    // 如果正在连接中，等待连接完成
    if (connectionPromise) {
        return connectionPromise;
    }

    if (!DAT_MONGO_URI) {
        logger.warn('DAT_MONGO_URI not configured, DAT project features will be unavailable');
        return null;
    }

    // 创建连接 Promise
    connectionPromise = (async () => {
        try {
            // 隐藏密码后记录连接 URI
            const safeUri = DAT_MONGO_URI.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
            logger.info(`Connecting to DAT MongoDB: ${safeUri}`);

            const conn = mongoose.createConnection(DAT_MONGO_URI, {
                bufferCommands: true,
            });

            // 等待连接成功
            await new Promise((resolve, reject) => {
                conn.on('connected', () => {
                    logger.info('Successfully connected to DAT MongoDB database');
                    resolve();
                });
                conn.on('error', (err) => {
                    logger.error('DAT MongoDB connection error:', err);
                    reject(err);
                });
            });

            datConnection = conn;
            return datConnection;
        } catch (error) {
            logger.error('Failed to connect to DAT MongoDB:', error);
            connectionPromise = null;
            throw error;
        }
    })();

    return connectionPromise;
}

module.exports = {
    getDatConnection,
};
