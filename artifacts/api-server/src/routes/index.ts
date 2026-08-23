import { Router, type IRouter } from "express";
import healthRouter from "./health";
import teamAuthRouter from "./team-auth";
import erpDataRouter from "./erp-data";
import accountingRouter from "./accounting";
import inventoryRouter from "./inventory";

const router: IRouter = Router();

router.use(healthRouter);
router.use(teamAuthRouter);
router.use(erpDataRouter);
router.use(inventoryRouter);
router.use(accountingRouter);

export default router;
