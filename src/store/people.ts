/* THE PEOPLE PAGE's data: people, who knows whom, and every logged contact.
   Deleting buries the rows like every other deletion, so a device that has not
   heard about it yet cannot merge them back. */
import { useState } from 'react'
import { rowKey } from '../sync-merge'
import type { ContactChannel, Person, PersonBond, PersonContact, PersonTier } from '../types'
import { newId } from './shared'

export type PersonInput = { name: string; rel?: string; tier: PersonTier; cadenceDays: number; x: number; y: number }
type PersonPatch = Partial<Pick<Person, 'name' | 'rel' | 'tier' | 'cadenceDays' | 'x' | 'y'>>

export interface PeopleSlice {
  people: Person[]
  setPeople: (next: Person[]) => void
  personBonds: PersonBond[]
  setPersonBonds: (next: PersonBond[]) => void
  personContacts: PersonContact[]
  setPersonContacts: (next: PersonContact[]) => void
  addPerson: (p: PersonInput) => string
  updatePerson: (id: string, patch: PersonPatch) => void
  deletePerson: (id: string) => void
  addPersonBond: (a: string, b: string) => void
  removePersonBond: (id: string) => void
  logContact: (personId: string, day: string, channel: ContactChannel) => void
  removeContact: (id: string) => void
}

export function usePeopleSlice(
  persisted: { people?: Person[]; personBonds?: PersonBond[]; personContacts?: PersonContact[] } | null,
  deps: { armUndo: (label: string, restore: () => void) => void; bury: (...keys: string[]) => void; digUp: (...keys: string[]) => void },
): PeopleSlice {
  const { armUndo, bury, digUp } = deps
  const [people, setPeople] = useState<Person[]>(persisted?.people ?? [])
  const [personBonds, setPersonBonds] = useState<PersonBond[]>(persisted?.personBonds ?? [])
  const [personContacts, setPersonContacts] = useState<PersonContact[]>(persisted?.personContacts ?? [])

  const addPerson = (p: PersonInput): string => {
    const id = newId('person')
    const now = Date.now()
    setPeople((prev) => [...prev, {
      id, name: p.name.trim(), rel: (p.rel ?? '').trim(), tier: p.tier, cadenceDays: p.cadenceDays,
      x: Math.round(p.x), y: Math.round(p.y), createdAt: now, updatedAt: now,
    }])
    return id
  }

  const updatePerson = (id: string, patch: PersonPatch): void => setPeople((prev) => prev.map((p) => (p.id === id
    ? {
      ...p, ...patch,
      ...(patch.x !== undefined ? { x: Math.round(patch.x) } : {}),
      ...(patch.y !== undefined ? { y: Math.round(patch.y) } : {}),
      updatedAt: Date.now(),
    }
    : p)))

  const deletePerson = (id: string): void => {
    const before = { people, personBonds, personContacts }
    const bonds = personBonds.filter((b) => b.a === id || b.b === id)
    const contacts = personContacts.filter((c) => c.personId === id)
    const keys = [
      rowKey('people', { id }),
      ...bonds.map((b) => rowKey('personBonds', { id: b.id })),
      ...contacts.map((c) => rowKey('personContacts', { id: c.id })),
    ]
    setPeople((prev) => prev.filter((p) => p.id !== id))
    setPersonBonds((prev) => prev.filter((b) => b.a !== id && b.b !== id))
    setPersonContacts((prev) => prev.filter((c) => c.personId !== id))
    bury(...keys)
    armUndo('Person removed', () => {
      setPeople(before.people)
      setPersonBonds(before.personBonds)
      setPersonContacts(before.personContacts)
      digUp(...keys)
    })
  }

  const addPersonBond = (a: string, b: string): void => {
    if (a === b) return
    setPersonBonds((prev) => (prev.some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))
      ? prev
      : [...prev, { id: newId('bond'), a, b, createdAt: Date.now() }]))
  }

  const removePersonBond = (id: string): void => {
    setPersonBonds((prev) => prev.filter((b) => b.id !== id))
    bury(rowKey('personBonds', { id }))
  }

  const logContact = (personId: string, day: string, channel: ContactChannel): void => {
    setPersonContacts((prev) => [...prev, { id: newId('contact'), personId, day, channel, createdAt: Date.now() }])
  }

  const removeContact = (id: string): void => {
    const before = personContacts
    setPersonContacts((prev) => prev.filter((c) => c.id !== id))
    bury(rowKey('personContacts', { id }))
    armUndo('Contact removed', () => { setPersonContacts(before); digUp(rowKey('personContacts', { id })) })
  }

  return {
    people, setPeople, personBonds, setPersonBonds, personContacts, setPersonContacts,
    addPerson, updatePerson, deletePerson, addPersonBond, removePersonBond, logContact, removeContact,
  }
}
