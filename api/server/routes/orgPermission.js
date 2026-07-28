const express = require('express');
const multer = require('multer');
const { requireJwtAuth, checkAdmin } = require('~/server/middleware');
const {
  listUnits,
  createUnit,
  updateUnit,
  deleteUnit,
  clearUnits,
  importFromTable,
  importFromExcel,
  getSettings,
  updateSettings,
} = require('~/server/controllers/OrgPermissionController');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.use(requireJwtAuth, checkAdmin);

router.get('/settings', getSettings);
router.put('/settings', updateSettings);

router.get('/units', listUnits);
router.post('/units', createUnit);
router.post('/units/import-table', importFromTable);
router.post('/units/import-excel', upload.single('file'), importFromExcel);
router.delete('/units', clearUnits);
router.put('/units/:orgCode', updateUnit);
router.delete('/units/:orgCode', deleteUnit);

module.exports = router;
