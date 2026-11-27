import connectMySQL from '../config/mysql.js';
import { generateToken } from '../src/token.js';
import fs from 'fs';
import path from 'path';
import User from '../models/User.js';

export const loginUser = async ({ username, password }) => {
  let connection;
  try {
    connection = await connectMySQL(false);
    let [rows] = await connection.execute(
      'SELECT lv001, lv004, lv006, lv008 FROM lv_lv0007 WHERE BINARY lv001 = ? AND lv005 = md5(?)',
      [username, password]
    );

    if (rows.length === 0) {
      throw new Error('Sai tài khoản hoặc mật khẩu');
    }
    const user = rows[0];

    const [accessRows] = await connection.execute(
      'SELECT 1 FROM hr_lv0020 WHERE lv001 = ? LIMIT 1',
      [user.lv006]
    );

    if (accessRows.length === 0) {
      throw new Error('Người dùng không được phép truy cập ứng dụng, vui lòng liên hệ Admin');
    }

    let connectionDoc = await connectMySQL(true);
    let [avatarRows] = await connectionDoc.execute(
      'SELECT lv008 FROM hr_lv0041 WHERE lv002 = ?',
      [user.lv006]
    );

    if (avatarRows.length === 0) {
      const defaultAvatarPath = '../default_avatar.png';
      let base64 = '';
      try {
        const imageBuffer = fs.readFileSync(defaultAvatarPath);
        base64 = imageBuffer.toString('base64');
      } catch (err) {
        base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8//8/AzSAAwAB/4cA6AAAAABJRU5ErkJggg==';
      }
      user.avatar = `data:image/png;base64,${base64}`;
    } else {
      const base64 = avatarRows[0].lv008.toString('base64');
      user.avatar = `data:image/png;base64,${base64}`;
    }

    connectionDoc.release(); // Trả kết nối về pool
    connection.release(); // Trả kết nối về pool
    return user;
  } catch (error) {
    if (connection) connection.release();
    throw new Error(`${error.message}`);
  }
};

export const createToken = async (username) => {
  let connection;
  try {
    connection = await connectMySQL(false);
    const token = generateToken(username);
    await connection.execute(
      'UPDATE lv_lv0007 SET lv008 = ? WHERE lv001 = ?',
      [token, username]
    );
    connection.release(); // Trả kết nối về pool
    return token;
  } catch (error) {
    if (connection) connection.release();
    throw new Error(`Failed to insert token: ${error.message}`);
  }
};

export const logoutUser = async (username) => {
  let connection;
  try {
    connection = await connectMySQL(false);
    const [rows] = await connection.execute(
      'SELECT lv008 FROM lv_lv0007 WHERE lv001 = ?',
      [username]
    );
    if (rows[0].lv008 === '') {
      connection.release();
      return false;
    }
    await connection.execute(
      'UPDATE lv_lv0007 SET lv008 = "" WHERE lv001 = ?',
      [username]
    );
    connection.release(); // Trả kết nối về pool
    return true;
  } catch (error) {
    if (connection) connection.release();
    throw new Error(`Failed to logout: ${error.message}`);
  }
};

// Đồng bộ user từ MySQL sang MongoDB
export const syncUserFromMySQL = async (mysqlUser) => {
  let connectionDoc;
  let connection;
  try {
    // Lấy thông tin name từ bảng hr_lv0020
    connection = await connectMySQL(false);
    const [nameRows] = await connection.execute(
      'SELECT lv002 FROM hr_lv0020 WHERE lv001 = ?',
      [mysqlUser.lv006]
    );

    if (nameRows.length === 0) {
      throw new Error(`Không tìm thấy thông tin name cho user ${mysqlUser.lv001}`);
    }

    mysqlUser.name = nameRows[0].lv002;
    // Nếu user object chưa có avatar, lấy từ database
    if (!mysqlUser.avatar) {
      connectionDoc = await connectMySQL(true);
      let [avatarRows] = await connectionDoc.execute(
        'SELECT lv008 FROM hr_lv0041 WHERE lv002 = ?',
        [mysqlUser.lv006]
      );

      if (avatarRows.length === 0) {
        // Avatar mặc định nếu không có
        mysqlUser.avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8//8/AzSAAwAB/4cA6AAAAABJRU5ErkJggg==';
      } else {
        const base64 = avatarRows[0].lv008.toString('base64');
        mysqlUser.avatar = `data:image/png;base64,${base64}`;
      }
      connectionDoc.release();
    }

    let mongoUser = await User.findOne({ lv001: mysqlUser.lv001 });

    let isNewUser = false;
    if (!mongoUser) {
      // Tạo user mới trong MongoDB từ dữ liệu MySQL
      mongoUser = await User.create({
        lv001: mysqlUser.lv001,
        name: mysqlUser.name,
        maNhanVien: mysqlUser.lv006,
        avatar: mysqlUser.avatar,
        onlineStatus: true,
        lastActive: new Date(),
      });
      isNewUser = true;
    } else {
      // Cập nhật thông tin user từ MySQL (đồng bộ dữ liệu)
      mongoUser.name = mysqlUser.name;
      mongoUser.maNhanVien = mysqlUser.lv006;
      mongoUser.avatar = mysqlUser.avatar;
      mongoUser.onlineStatus = true;
      mongoUser.lastActive = new Date();
      await mongoUser.save();
    }

    return { mongoUser, isNewUser };
  } catch (error) {
    if (connectionDoc) connectionDoc.release();
    if (connection) connection.release();
    throw new Error(`Lỗi đồng bộ user: ${error.message}`);
  }
};

// Đồng bộ tất cả user từ MySQL sang MongoDB (chỉ user có quyền truy cập)
export const syncAllUsersFromMySQL = async () => {
  let connection;
  let connectionDoc;
  try {
    connection = await connectMySQL(false);
    connectionDoc = await connectMySQL(true);

    // Lấy tất cả user từ MySQL có quyền truy cập (join với hr_lv0020)
    const [rows] = await connection.execute(`
      SELECT u.lv001, u.lv003, u.lv004, u.lv006, a.lv002 as name
      FROM lv_lv0007 u
      INNER JOIN hr_lv0020 a ON u.lv006 = a.lv001
      WHERE u.lv001 IS NOT NULL
      AND u.lv003 IS NOT NULL
      AND u.lv004 IS NOT NULL
      AND u.lv006 IS NOT NULL
      AND a.lv002 IS NOT NULL
    `);

    const skippedUsers = [];
    const batchSize = 250;
    const uniqueRows = [...new Map(rows.map(row => [String(row.lv001), row])).values()];
    const employeeIds = [...new Set(uniqueRows.map(row => String(row.lv006)))];
    const avatarByEmployeeId = new Map();

    // Read avatar blobs in bounded batches instead of opening one MySQL query per employee.
    for (let offset = 0; offset < employeeIds.length; offset += batchSize) {
      const batch = employeeIds.slice(offset, offset + batchSize);
      const placeholders = batch.map(() => '?').join(',');
      const [avatarRows] = await connectionDoc.execute(
        `SELECT lv002, lv008 FROM hr_lv0041 WHERE lv002 IN (${placeholders})`,
        batch
      );
      for (const avatarRow of avatarRows) {
        const employeeId = String(avatarRow.lv002);
        if (!avatarByEmployeeId.has(employeeId) && avatarRow.lv008) {
          avatarByEmployeeId.set(employeeId, Buffer.from(avatarRow.lv008).toString('base64'));
        }
      }
    }

    const missingAvatarCount = uniqueRows.filter(row => !avatarByEmployeeId.has(String(row.lv006))).length;
    const defaultAvatar = missingAvatarCount > 0
      ? `data:image/png;base64,${fs.readFileSync(
          new URL('../images/default-avatar.png', import.meta.url)
        ).toString('base64')}`
      : '';
    const syncRows = uniqueRows.map(mysqlUser => ({
      username: String(mysqlUser.lv001),
      employeeId: String(mysqlUser.lv006),
      name: mysqlUser.name,
      role: mysqlUser.lv003,
      avatar: avatarByEmployeeId.has(String(mysqlUser.lv006))
        ? `data:image/png;base64,${avatarByEmployeeId.get(String(mysqlUser.lv006))}`
        : defaultAvatar,
    }));

    // Fetch current records once per batch so duplicate employee IDs remain safely rejected.
    const existingByUsername = new Map();
    const existingByEmployeeId = new Map();
    for (let offset = 0; offset < syncRows.length; offset += batchSize) {
      const batch = syncRows.slice(offset, offset + batchSize);
      const [byUsername, byEmployeeId] = await Promise.all([
        User.find({ lv001: { $in: batch.map(row => row.username) } })
          .select('lv001 maNhanVien name avatar')
          .lean(),
        User.find({ maNhanVien: { $in: batch.map(row => row.employeeId) } })
          .select('lv001 maNhanVien')
          .lean(),
      ]);
      byUsername.forEach(user => existingByUsername.set(String(user.lv001), user));
      byEmployeeId.forEach(user => existingByEmployeeId.set(String(user.maNhanVien), user));
    }

    let syncedCount = 0;
    let newUsersCount = 0;
    let updatedUsersCount = 0;
    const operations = [];
    const operationRows = [];
    const employeeOwnerById = new Map(existingByEmployeeId);

    for (const row of syncRows) {
      const existingUser = existingByUsername.get(row.username);
      const owner = employeeOwnerById.get(row.employeeId);
      if (owner && String(owner.lv001) !== row.username) {
        skippedUsers.push({
          username: row.username,
          reason: `maNhanVien ${row.employeeId} đã tồn tại cho user ${owner.lv001}`
        });
        continue;
      }

      if (existingUser && String(existingUser.maNhanVien) !== row.employeeId) {
        const previousOwner = employeeOwnerById.get(String(existingUser.maNhanVien));
        if (String(previousOwner?.lv001 || '') === row.username) {
          employeeOwnerById.delete(String(existingUser.maNhanVien));
        }
      }
      employeeOwnerById.set(row.employeeId, { lv001: row.username });
      const hasChanges = !existingUser ||
        existingUser.name !== row.name ||
        String(existingUser.maNhanVien) !== row.employeeId ||
        existingUser.avatar !== row.avatar;
      if (!hasChanges) {
        syncedCount++;
        continue;
      }

      operations.push({
        updateOne: {
          filter: { lv001: row.username },
          update: {
            $set: {
              name: row.name,
              maNhanVien: row.employeeId,
              avatar: row.avatar,
            },
            ...(!existingUser ? {
              $setOnInsert: {role: row.role, onlineStatus: false, lastActive: new Date()},
            } : {}),
          },
          upsert: true,
        },
      });
      operationRows.push({row});
    }

    // Keep writes bounded as avatar data can make batches large.
    for (let offset = 0; offset < operations.length; offset += 50) {
      const batchOperations = operations.slice(offset, offset + 50);
      const batchRows = operationRows.slice(offset, offset + 50);
      try {
        const result = await User.bulkWrite(batchOperations, { ordered: false });
        syncedCount += batchOperations.length;
        newUsersCount += result.upsertedCount || 0;
        updatedUsersCount += result.modifiedCount || 0;
      } catch (error) {
        const writeErrors = error?.writeErrors || error?.result?.getWriteErrors?.() || [];
        if (!writeErrors.length) throw error;
        const failedIndexes = new Set(writeErrors.map(writeError => writeError.index));
        const partialResult = error.result?.result || error.result || {};
        const upsertedCount = partialResult.upsertedCount || partialResult.nUpserted || 0;
        const modifiedCount = partialResult.modifiedCount || partialResult.nModified || 0;
        const succeeded = batchOperations.length - failedIndexes.size;
        syncedCount += succeeded;
        newUsersCount += upsertedCount;
        updatedUsersCount += modifiedCount;
        writeErrors.forEach(writeError => {
          const failedRow = batchRows[writeError.index]?.row;
          skippedUsers.push({ username: failedRow?.username, reason: writeError.errmsg || writeError.message });
        });
      }
    }

    connection.release();
    connectionDoc.release();
    return {
      totalUsers: rows.length,
      syncedUsers: syncedCount,
      newUsers: newUsersCount,
      updatedUsers: updatedUsersCount,
      skippedUsers: skippedUsers
    };
  } catch (error) {
    if (connection) connection.release();
    if (connectionDoc) connectionDoc.release();
    throw new Error(`Lỗi đồng bộ tất cả user: ${error.message}`);
  }
};
