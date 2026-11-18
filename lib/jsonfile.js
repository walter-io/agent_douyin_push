// JSON 文件原子写:先写同目录 .tmp 再 rename。
// 直接 writeFileSync 覆盖原文件,进程崩溃在写入中途会把数据文件写坏(load 静默回退空数据);
// rename 同目录内是原子操作,目标文件要么是旧内容要么是完整新内容。
'use strict';
const fs = require('fs');

function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

module.exports = { writeJsonAtomic };
