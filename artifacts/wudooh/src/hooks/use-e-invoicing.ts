import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@/context/store';

export type EGSUnit = {
  id: number;
  unitName: string;
  deviceSerialNumber: string;
  environment: 'sandbox' | 'production';
  status: string;
  sellerName: string;
  vatNumber: string;
  commercialRegistrationNumber: string;
  street: string;
  buildingNumber: string;
  city: string;
  postalCode: string;
  countryCode: string;
  vatRate: number;
  pricesIncludeVat: boolean;
  configurationComplete: boolean;
  csrReady: boolean;
  credentialsReady: boolean;
  certificateExpiresAt: string | null;
  certificateExpiryWarningDays: number;
  certificateStatus: 'missing' | 'valid' | 'expiring' | 'expired';
  certificateDaysRemaining: number | null;
  certificateUsable: boolean;
  readyForSubmission: boolean;
  complianceStatus: 'not_started' | 'checking' | 'passed' | 'failed' | 'unknown';
  complianceSuiteStatus: 'not_started' | 'checking' | 'passed' | 'failed' | 'unknown';
  complianceSuiteResults: ComplianceFixtureResult[];
  complianceSuite: {
    status: EGSUnit['complianceSuiteStatus'];
    checkedAt: string | null;
    fixtures: Array<{
      id: ComplianceFixtureResult['fixtureId'];
      label: string;
      documentType: EInvoiceDocument['documentType'];
      scenario: string;
      result: ComplianceFixtureResult | null;
    }>;
  };
  lastComplianceCheckAt: string | null;
  complianceError: string | null;
};

export type ComplianceFixtureResult = {
  fixtureId: 'simplified' | 'standard' | 'credit_note' | 'debit_note';
  label: string;
  documentType: EInvoiceDocument['documentType'];
  documentId: number | null;
  invoiceNumber: string | null;
  status: 'passed' | 'failed' | 'unknown' | 'missing';
  httpStatus: number | null;
  authorityMessage: string | null;
  checkedAt: string;
};

export type EInvoiceDocument = {
  id: number;
  invoiceRecordId: number;
  parentDocumentId: number | null;
  parentInvoiceNumber: string | null;
  documentType: 'simplified' | 'standard' | 'credit_note' | 'debit_note';
  status: 'pending_configuration' | 'pending_credentials' | 'pending_compliance' | 'pending_submission' | 'certificate_action_required' | 'certificate_expired' | 'submitting' | 'submission_unknown' | 'reported' | 'cleared' | 'rejected';
  invoiceNumber: string;
  uuid: string;
  invoiceCounter: number;
  qrPayload: string;
  submissionReference: string | null;
  submissionError: string | null;
  submissionAttempts: number;
  localValidationError: string | null;
  authorityXmlAvailable: boolean;
  issuedAt: string;
  lastSubmissionAt: string | null;
  adjustmentReason: string | null;
  taxExclusiveAmount: number | null;
  taxAmount: number | null;
  taxInclusiveAmount: number | null;
  xmlAvailable: boolean;
};

export function useEInvoicingSetup() {
  const { currentUser } = useStore();

  return useQuery({
    queryKey: ['e-invoicing-setup'],
    queryFn: async () => {
      const res = await fetch('/api/e-invoicing/setup', {
        headers: {
          'X-Wudooh-Data-Generation': String(currentUser?.dataGeneration ?? 0),
        },
        credentials: 'include',
      });
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error('Failed to load setup');
      }
      const data = await res.json();
      return data.unit as EGSUnit;
    },
    enabled: !!currentUser && currentUser.roleId === 'owner',
  });
}

export function useUpdateSetup() {
  const queryClient = useQueryClient();
  const { currentUser } = useStore();

  return useMutation({
    mutationFn: async (setupData: Partial<EGSUnit>) => {
      const res = await fetch('/api/e-invoicing/setup', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Wudooh-Data-Generation': String(currentUser?.dataGeneration ?? 0),
        },
        credentials: 'include',
        body: JSON.stringify(setupData),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to update setup');
      }
      const data = await res.json();
      return data.unit as EGSUnit;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['e-invoicing-setup'], data);
    },
  });
}

export function useGenerateCsr() {
  const queryClient = useQueryClient();
  const { currentUser } = useStore();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/e-invoicing/setup/csr', {
        method: 'POST',
        headers: {
          'X-Wudooh-Data-Generation': String(currentUser?.dataGeneration ?? 0),
        },
        credentials: 'include',
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to generate CSR');
      }
      const data = await res.json();
      return { unit: data.unit as EGSUnit, csrPem: data.csrPem as string };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['e-invoicing-setup'], data.unit);
    },
  });
}

export function useUpdateCertificateWarning() {
  const queryClient = useQueryClient();
  const { currentUser } = useStore();

  return useMutation({
    mutationFn: async (certificateExpiryWarningDays: number) => {
      const res = await fetch('/api/e-invoicing/setup/certificate-warning', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Wudooh-Data-Generation': String(currentUser?.dataGeneration ?? 0),
        },
        credentials: 'include',
        body: JSON.stringify({ certificateExpiryWarningDays }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to update certificate warning');
      }
      const data = await res.json();
      return data.unit as EGSUnit;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['e-invoicing-setup'], data);
    },
  });
}

export function useUpdateCredentials() {
  const queryClient = useQueryClient();
  const { currentUser } = useStore();

  return useMutation({
    mutationFn: async (credentials: { certificatePem: string; csid: string; secret: string }) => {
      const res = await fetch('/api/e-invoicing/credentials', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Wudooh-Data-Generation': String(currentUser?.dataGeneration ?? 0),
        },
        credentials: 'include',
        body: JSON.stringify(credentials),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to update credentials');
      }
      const data = await res.json();
      return data.unit as EGSUnit;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['e-invoicing-setup'], data);
    },
  });
}

export function useEInvoicingDocuments() {
  const { currentUser } = useStore();

  return useQuery({
    queryKey: ['e-invoicing-documents'],
    queryFn: async () => {
      const res = await fetch('/api/e-invoicing/documents', {
        headers: {
          'X-Wudooh-Data-Generation': String(currentUser?.dataGeneration ?? 0),
        },
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Failed to load documents');
      }
      const data = await res.json();
      return data.documents as EInvoiceDocument[];
    },
    enabled: !!currentUser,
  });
}

export function useSubmitDocument() {
  const queryClient = useQueryClient();
  const { currentUser } = useStore();

  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/e-invoicing/documents/${id}/submit`, {
        method: 'POST',
        headers: {
          'X-Wudooh-Data-Generation': String(currentUser?.dataGeneration ?? 0),
        },
        credentials: 'include',
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to submit document');
      }
      const data = await res.json();
      return data.document as EInvoiceDocument;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['e-invoicing-documents'] });
    },
  });
}

export function useComplianceCheck() {
  const queryClient = useQueryClient();
  const { currentUser } = useStore();

  return useMutation({
    mutationFn: async (documentId: number) => {
      const res = await fetch('/api/e-invoicing/compliance/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Wudooh-Data-Generation': String(currentUser?.dataGeneration ?? 0),
        },
        credentials: 'include',
        body: JSON.stringify({ documentId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to run compliance check');
      }
      return await res.json() as { unit: EGSUnit };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['e-invoicing-setup'], data.unit);
      queryClient.invalidateQueries({ queryKey: ['e-invoicing-documents'] });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['e-invoicing-setup'] });
      queryClient.invalidateQueries({ queryKey: ['e-invoicing-documents'] });
    },
  });
}

export function useAddDocumentNote() {
  const queryClient = useQueryClient();
  const { currentUser } = useStore();

  return useMutation({
    mutationFn: async ({ id, operationId, ...payload }: { id: number; operationId: string; type: 'credit_note' | 'debit_note'; reason: string; amount: number; customerVatNumber?: string }) => {
      const res = await fetch(`/api/e-invoicing/documents/${id}/notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': operationId,
          'X-Wudooh-Data-Generation': String(currentUser?.dataGeneration ?? 0),
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to add note');
      }
      const data = await res.json();
      return data.document as EInvoiceDocument;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['e-invoicing-documents'] });
    },
  });
}
