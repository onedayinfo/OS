'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

export interface ContactValues {
  name: string;
  email: string;
  role: 'MANAGER' | 'CONTACT';
  phone: string;
}

export function ContactForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy?: boolean;
  onSubmit: (v: ContactValues) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'MANAGER' | 'CONTACT'>('CONTACT');

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || !email.trim()) return;
        onSubmit({ name: name.trim(), email: email.trim(), role, phone: phone.trim() });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ct-name">Nome</Label>
        <Input id="ct-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ct-email">E-mail</Label>
        <Input
          id="ct-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ct-phone">Telefone / WhatsApp</Label>
        <Input
          id="ct-phone"
          placeholder="(19) 99999-1234"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ct-role">Papel</Label>
        <Select
          id="ct-role"
          value={role}
          onChange={(e) => setRole(e.target.value as 'MANAGER' | 'CONTACT')}
        >
          <option value="CONTACT">Contato</option>
          <option value="MANAGER">Gestor</option>
        </Select>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          Adicionar contato
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
