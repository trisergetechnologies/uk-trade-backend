const { seedPackageCatalog } = require('./package-product.service');

async function seedDefaultPlans() {
  await seedPackageCatalog();
}

module.exports = { seedDefaultPlans };
