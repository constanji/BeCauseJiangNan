/**
 * SnowFlake算法 JavaScript实现
 * 基于Twitter的SnowFlake算法生成唯一ID
 *
 * ID结构：
 * 1位符号位(0) + 41位时间戳 + 5位数据中心ID + 5位机器ID + 12位序列号 = 64位
 */
class SnowFlake {
    constructor(datacenterId = 1, machineId = 1) {
        // 起始时间戳 2003-12-05 00:00:00
        this.START_TIMESTAMP = 1070553600000n;

        // 各部分占用的位数
        this.SEQUENCE_BITS = 12n; // 序列号占用位数
        this.MACHINE_BITS = 5n;   // 机器标识占用位数
        this.DATACENTER_BITS = 5n; // 数据中心占用位数

        // 各部分的最大值
        this.MAX_DATACENTER_NUM = (1n << this.DATACENTER_BITS) - 1n;
        this.MAX_MACHINE_NUM = (1n << this.MACHINE_BITS) - 1n;
        this.MAX_SEQUENCE = (1n << this.SEQUENCE_BITS) - 1n;

        // 各部分向左的位移
        this.MACHINE_LEFT = this.SEQUENCE_BITS;
        this.DATACENTER_LEFT = this.SEQUENCE_BITS + this.MACHINE_BITS;
        this.TIMESTAMP_LEFT = this.DATACENTER_LEFT + this.DATACENTER_BITS;

        // 验证参数
        if (datacenterId > this.MAX_DATACENTER_NUM || datacenterId < 0) {
            throw new Error(`datacenterId must be between 0 and ${this.MAX_DATACENTER_NUM}`);
        }
        if (machineId > this.MAX_MACHINE_NUM || machineId < 0) {
            throw new Error(`machineId must be between 0 and ${this.MAX_MACHINE_NUM}`);
        }

        this.datacenterId = BigInt(datacenterId);
        this.machineId = BigInt(machineId);
        this.sequence = 0n;
        this.lastTimestamp = -1n;
    }

    /**
     * 生成下一个ID
     * @returns {string} 生成的ID字符串
     */
    nextId() {
        let currentTimestamp = this.getCurrentTimestamp();

        // 时钟回拨检查
        if (currentTimestamp < this.lastTimestamp) {
            throw new Error('Clock moved backwards. Refusing to generate id');
        }

        if (currentTimestamp === this.lastTimestamp) {
            // 相同毫秒内，序列号自增
            this.sequence = (this.sequence + 1n) & this.MAX_SEQUENCE;
            // 同一毫秒的序列数已经达到最大，等待下一毫秒
            if (this.sequence === 0n) {
                currentTimestamp = this.getNextTimestamp();
            }
        } else {
            // 不同毫秒内，序列号置为0
            this.sequence = 0n;
        }

        this.lastTimestamp = currentTimestamp;

        // 组装ID
        const id = ((currentTimestamp - this.START_TIMESTAMP) << this.TIMESTAMP_LEFT) |
            (this.datacenterId << this.DATACENTER_LEFT) |
            (this.machineId << this.MACHINE_LEFT) |
            this.sequence;

        return id.toString();
    }

    /**
     * 获取当前时间戳
     * @returns {bigint} 当前时间戳
     */
    getCurrentTimestamp() {
        return BigInt(Date.now());
    }

    /**
     * 获取下一毫秒时间戳
     * @returns {bigint} 下一毫秒时间戳
     */
    getNextTimestamp() {
        let timestamp = this.getCurrentTimestamp();
        while (timestamp <= this.lastTimestamp) {
            timestamp = this.getCurrentTimestamp();
        }
        return timestamp;
    }

    /**
     * 解析ID，获取各部分信息
     * @param {string|bigint} id 要解析的ID
     * @returns {object} 解析结果
     */
    parseId(id) {
        const bigId = typeof id === 'string' ? BigInt(id) : id;

        const timestamp = (bigId >> this.TIMESTAMP_LEFT) + this.START_TIMESTAMP;
        const datacenterId = (bigId >> this.DATACENTER_LEFT) & this.MAX_DATACENTER_NUM;
        const machineId = (bigId >> this.MACHINE_LEFT) & this.MAX_MACHINE_NUM;
        const sequence = bigId & this.MAX_SEQUENCE;

        return {
            timestamp: Number(timestamp),
            datacenterId: Number(datacenterId),
            machineId: Number(machineId),
            sequence: Number(sequence),
            date: new Date(Number(timestamp))
        };
    }
}

// 创建默认实例
const defaultSnowFlake = new SnowFlake(1, 1);

/**
 * 生成SnowFlake ID的便捷函数
 * @returns {string} 生成的ID
 */
export function generateId() {
    return defaultSnowFlake.nextId();
}

/**
 * 解析SnowFlake ID
 * @param {string|bigint} id 要解析的ID
 * @returns {object} 解析结果
 */
export function parseSnowFlakeId(id) {
    return defaultSnowFlake.parseId(id);
}

/**
 * 创建自定义SnowFlake实例
 * @param {number} datacenterId 数据中心ID (0-31)
 * @param {number} machineId 机器ID (0-31)
 * @returns {SnowFlake} SnowFlake实例
 */
export function createSnowFlake(datacenterId, machineId) {
    return new SnowFlake(datacenterId, machineId);
}

export default SnowFlake;
