import { Router, type IRouter } from "express";
import healthRouter from "./health";
import teamAuthRouter from "./team-auth";
import erpDataRouter from "./erp-data";

const router: IRouter = Router();

router.use(healthRouter);
router.use(teamAuthRouter);
router.use(erpDataRouter);

export default router;
