const fs = require("fs");
const path = "node_modules/react-native-push-notification/android/build.gradle";
if (fs.existsSync(path)) {
  let data = fs.readFileSync(path, "utf8");
  // Thay thế bất kỳ dòng com.android.support:appcompat-v7 thành androidx.appcompat:appcompat:1.7.0
  data = data.replace(/com\.android\.support:appcompat-v7:[^"]+"/g, 'androidx.appcompat:appcompat:1.7.0"');
  // Nếu có logic chọn supportLib, thì thay luôn bằng androidx
  data = data.replace(/def appCompatLibName =.*\n.*implementation "\$appCompatLibName:\$supportLibVersion"\n/g, 'implementation "androidx.appcompat:appcompat:1.7.0"\n');
  fs.writeFileSync(path, data);
  console.log('Đã sửa build.gradle của react-native-push-notification thành dùng AndroidX!');
} 