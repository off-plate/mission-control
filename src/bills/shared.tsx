import { type DebtKind } from '../compassCalc'

export const money = (n: number): string => `${new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(Math.round(n))} Kč`

export const DEBT_KIND_LABEL: Record<DebtKind, string> = { structured: 'Loan', unstructured: 'Overdue', personal: 'Personal', tax: 'Tax' }
