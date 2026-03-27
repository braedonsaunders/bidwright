require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

(async () => {
  const builtIns = await db.entityCategory.findMany({ where: { isBuiltIn: true } });
  console.log('Built-in categories:', builtIns.map(c => c.name));
  if (builtIns.length > 0) {
    await db.entityCategory.updateMany({ where: { isBuiltIn: true }, data: { isBuiltIn: false } });
    console.log('Set all to isBuiltIn=false');
  } else {
    console.log('No built-in categories found');
  }
  await db.$disconnect();
})();
