const express = require("express");
const router = express.Router();
const controller = require("../controllers/DatasourcePromptController");

router.get("/", controller.list);
router.get("/:id", controller.get);
router.post("/", controller.create);
router.put("/batch-update", controller.batchUpdate);
router.put("/:id", controller.update);
router.delete("/:id", controller.delete);

module.exports = router;
