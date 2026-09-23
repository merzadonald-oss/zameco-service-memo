import { Router, type IRouter } from "express";
import healthRouter from "./health";
import memosRouter from "./memos";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(memosRouter);
router.use(settingsRouter);

export default router;
