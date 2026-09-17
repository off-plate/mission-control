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
  /** Link `from` to `other`, saying what `other` is to `from`. Linking an
   *  existing pair only sets that word. */
  addPersonBond: (from: string, other: string, otherIsTo?: string) => void
  /** Set what `other` is to `from` on an existing link. */
  setBondLabel: (bondId: string, from: string, otherIsTo: string) => void
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

  /* A bond stores each direction on its own side: aToB is what a is to b. So
     "what other is to from" lands in bToA when from is a, aToB otherwise. */
  const withLabel = (b: PersonBond, from: string, word: string): PersonBond => {
    const w = word.trim()
    return { ...b, ...(b.a === from ? { bToA: w } : { aToB: w }), updatedAt: Date.now() }
  }
  const addPersonBond = (from: string, other: string, otherIsTo = ''): void => {
    if (from === other) return
    setPersonBonds((prev) => {
      const have = prev.find((x) => (x.a === from && x.b === other) || (x.a === other && x.b === from))
      if (have) return otherIsTo ? prev.map((x) => (x.id === have.id ? withLabel(x, from, otherIsTo) : x)) : prev
      const now = Date.now()
      return [...prev, { id: newId('bond'), a: from, b: other, bToA: otherIsTo.trim(), createdAt: now, updatedAt: now }]
    })
  }
  const setBondLabel = (bondId: string, from: string, otherIsTo: string): void => {
    setPersonBonds((prev) => prev.map((x) => (x.id === bondId ? withLabel(x, from, otherIsTo) : x)))
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
    addPerson, updatePerson, deletePerson, addPersonBond, setBondLabel, removePersonBond, logContact, removeContact,
  }
}
