/* CONTACTS. Split out of store.tsx (2026-09-09), the second domain pulled
   into its own hook (see notes.ts for the pattern this follows). Genuinely
   self-contained: confirmed by grep before extracting that no Contact
   mutator here reads or writes any other domain's state. */
import { useState } from 'react'
import { rowKey } from '../sync-merge'
import type { Contact, ContactActivity } from '../types'
import { newId } from './shared'

export interface ContactsSlice {
  contacts: Contact[]
  setContacts: (next: Contact[]) => void
  contactActivity: ContactActivity[]
  setContactActivity: (next: ContactActivity[]) => void
  addContact: (name: string) => string
  updateContact: (id: string, patch: Partial<Pick<Contact, 'name' | 'tag' | 'phone' | 'email' | 'company' | 'role' | 'next' | 'notes' | 'projectId'>>) => void
  deleteContact: (id: string) => void
  logContactActivity: (id: string, type: ContactActivity['type'], note?: string) => void
  deleteContactActivity: (activityId: string) => void
}

export function useContactsSlice(
  persisted: { contacts?: Contact[]; contactActivity?: ContactActivity[] } | null,
  deps: { armUndo: (label: string, restore: () => void) => void; bury: (...keys: string[]) => void; digUp: (...keys: string[]) => void },
): ContactsSlice {
  const { armUndo, bury, digUp } = deps
  const [contacts, setContacts] = useState<Contact[]>(persisted?.contacts ?? [])
  const [contactActivity, setContactActivity] = useState<ContactActivity[]>(persisted?.contactActivity ?? [])

  const addContact = (name: string): string => {
    const trimmed = name.trim()
    const id = newId('contact')
    if (!trimmed) return id
    setContacts((prev) => [...prev, { id, name: trimmed, tag: '', createdAt: new Date().toISOString() }])
    return id
  }
  const updateContact: ContactsSlice['updateContact'] = (id, patch) => setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const deleteContact = (id: string): void => {
    const beforeContacts = contacts
    const beforeActivity = contactActivity
    const gone = contacts.find((c) => c.id === id)
    const theirs = contactActivity.filter((a) => a.contactId === id)
    const keys = [rowKey('contacts', { id }), ...theirs.map((a) => rowKey('contactActivity', { id: a.id }))]
    setContacts((prev) => prev.filter((c) => c.id !== id))
    setContactActivity((prev) => prev.filter((a) => a.contactId !== id))
    bury(...keys)
    armUndo(gone ? `Deleted "${gone.name}"` : 'Contact deleted', () => { setContacts(beforeContacts); setContactActivity(beforeActivity); digUp(...keys) })
  }
  const logContactActivity = (id: string, type: ContactActivity['type'], note?: string): void =>
    setContactActivity((prev) => [{ id: newId('act'), contactId: id, type, at: new Date().toISOString(), note }, ...prev])
  const deleteContactActivity = (activityId: string): void => {
    const before = contactActivity
    const gone = contactActivity.find((a) => a.id === activityId)
    setContactActivity((prev) => prev.filter((a) => a.id !== activityId))
    bury(rowKey('contactActivity', { id: activityId }))
    armUndo(gone ? `Removed the logged ${gone.type}` : 'Entry removed', () => {
      setContactActivity(before); digUp(rowKey('contactActivity', { id: activityId }))
    })
  }

  return { contacts, setContacts, contactActivity, setContactActivity, addContact, updateContact, deleteContact, logContactActivity, deleteContactActivity }
}
