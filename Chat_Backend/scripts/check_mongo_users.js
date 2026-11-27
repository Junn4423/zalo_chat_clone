
import connectDB from '../config/db.js';
import User from '../models/User.js';
import dotenv from "dotenv";

dotenv.config({ quiet: true });

(async () => {
    try {
        await connectDB();
        const users = await User.find({});
        console.log(`Total users in MongoDB: ${users.length}`);
        console.log('------------------------------------------------');
        users.forEach(u => {
            console.log(`- ${u.lv001} (${u.name}) - maNhanVien: ${u.maNhanVien} - Online: ${u.onlineStatus}`);
        });
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
})();
