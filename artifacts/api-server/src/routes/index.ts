import { Router, type IRouter } from "express";
import healthRouter from "./health";
import teamAuthRouter from "./team-auth";
import erpDataRouter from "./erp-data";
import accountingRouter from "./accounting";
import inventoryRouter from "./inventory";
import backupRouter from "./backup";
import eInvoicingRouter from "./e-invoicing";
import billingRouter from "./billing";
import platformAdminRouter from "./platform-admin";
import financialAssistantRouter from "./financial-assistant";
import attachmentsRouter from "./attachments";
import dataTransferRouter from "./data-transfer";

const router: IRouter = Router();

router.use(healthRouter);
router.use(teamAuthRouter);
router.use(erpDataRouter);
router.use(inventoryRouter);
router.use(accountingRouter);
router.use(backupRouter);
router.use(eInvoicingRouter);
router.use(billingRouter);
router.use(platformAdminRouter);
router.use(financialAssistantRouter);
router.use(attachmentsRouter);
router.use(dataTransferRouter);

export default router;
