'use client';
import { useState, useEffect } from 'react';
import { Star } from 'lucide-react';

interface StarButtonProps {
  companyName: string;
  collegeName?: string;
  size?: 'sm' | 'md';
}

export default function StarButton({ companyName, collegeName, size = 'md' }: StarButtonProps) {
  const [starred, setStarred] = useState(false);
  const [loading, setLoading] = useState(false);
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  const getEmail = () => {
    try {
      const profile = JSON.parse(localStorage.getItem('placeiq_profile') || '{}');
      return profile.email || null;
    } catch { return null; }
  };

  useEffect(() => {
    const email = getEmail();
    if (!email || !companyName) return;
    fetch(`${apiUrl}/api/starred/check?email=${encodeURIComponent(email)}&company=${encodeURIComponent(companyName)}`)
      .then(r => r.json())
      .then(d => setStarred(d.starred))
      .catch(() => {});
  }, [companyName]);

  const toggle = async () => {
    const email = getEmail();
    if (!email) return;
    setLoading(true);
    try {
      if (starred) {
        await fetch(`${apiUrl}/api/starred/remove`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_email: email, company_name: companyName })
        });
        setStarred(false);
      } else {
        await fetch(`${apiUrl}/api/starred/add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_email: email, company_name: companyName, college_name: collegeName })
        });
        setStarred(true);
      }
    } catch {}
    setLoading(false);
  };

  return (
    <button
      onClick={toggle}
      disabled={loading}
      title={starred ? 'Remove from starred' : 'Star to track this company'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: size === 'sm' ? '4px 8px' : '6px 12px',
        borderRadius: '6px',
        border: `1px solid ${starred ? '#f59e0b' : 'var(--border-default)'}`,
        background: starred ? 'rgba(245,158,11,0.1)' : 'transparent',
        color: starred ? '#f59e0b' : 'var(--text-secondary)',
        fontSize: size === 'sm' ? '12px' : '13px',
        fontWeight: 500,
        cursor: loading ? 'not-allowed' : 'pointer',
        transition: 'all 150ms ease-out',
        opacity: loading ? 0.6 : 1,
        flexShrink: 0,
      }}
    >
      <Star size={size === 'sm' ? 13 : 15} fill={starred ? '#f59e0b' : 'none'} stroke={starred ? '#f59e0b' : 'currentColor'} />
      {starred ? 'Starred' : 'Star'}
    </button>
  );
}
