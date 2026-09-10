'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface LocationValues {
  name: string;
  address: string;
  contactName: string;
  contactPhone: string;
  accessNotes: string;
}

const EMPTY: LocationValues = {
  name: '',
  address: '',
  contactName: '',
  contactPhone: '',
  accessNotes: '',
};

export function LocationForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<LocationValues>;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (v: LocationValues) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? EMPTY.name);
  const [address, setAddress] = useState(initial?.address ?? EMPTY.address);
  const [contactName, setContactName] = useState(
    initial?.contactName ?? EMPTY.contactName,
  );
  const [contactPhone, setContactPhone] = useState(
    initial?.contactPhone ?? EMPTY.contactPhone,
  );
  const [accessNotes, setAccessNotes] = useState(
    initial?.accessNotes ?? EMPTY.accessNotes,
  );

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSubmit({
          name: name.trim(),
          address: address.trim(),
          contactName: contactName.trim(),
          contactPhone: contactPhone.trim(),
          accessNotes: accessNotes.trim(),
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="l-name">Nome</Label>
        <Input id="l-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="l-address">Endereço</Label>
        <Input
          id="l-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="l-contact-name">Contato</Label>
          <Input
            id="l-contact-name"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="l-contact-phone">Telefone</Label>
          <Input
            id="l-contact-phone"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="l-access">Notas de acesso</Label>
        <Textarea
          id="l-access"
          value={accessNotes}
          onChange={(e) => setAccessNotes(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
