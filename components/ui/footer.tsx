import { ExternalLink, Share2, Link2, Mail, MapPin } from 'lucide-react';
import Link from 'next/link';

export default function PlaceIQFooter() {
  return (
    <footer className="bg-[var(--bg-surface)] border-t border-[var(--border-default)] mt-16 w-full">
      <div className="mx-auto max-w-5xl px-6 pt-16 pb-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-4">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2">
              <span className="text-xl font-semibold text-[var(--text-primary)]">Place<span className="text-[var(--accent-blue)]">IQ</span></span>
            </div>
            <p className="text-[var(--text-secondary)] mt-4 text-sm leading-relaxed max-w-xs">
              India&apos;s first student-facing placement intelligence platform. Built by students, for students.
            </p>
            <div className="flex gap-4 mt-6">
              {[{ icon: ExternalLink, href: 'https://github.com' }, { icon: Share2, href: 'https://twitter.com' }, { icon: Link2, href: 'https://linkedin.com' }].map(({ icon: Icon, href }) => (
                <Link key={href} href={href} className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors duration-150">
                  <Icon className="w-4 h-4" />
                </Link>
              ))}
            </div>
          </div>

          <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-3 gap-8">
            <div>
              <p className="text-xs uppercase tracking-widest text-[var(--text-tertiary)] font-medium mb-4">Platform</p>
              <ul className="space-y-3 text-sm">
                {[['Dashboard', '/dashboard'], ['Skills', '/skills'], ['Companies', '/companies'], ['Roadmap', '/roadmap'], ['Market', '/market']].map(([label, href]) => (
                  <li key={href}><Link href={href} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors duration-150">{label}</Link></li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-[var(--text-tertiary)] font-medium mb-4">Opportunities</p>
              <ul className="space-y-3 text-sm">
                {[['Off Campus Jobs', '/offcampus'], ['Internships', '/internships'], ['On Campus', '/oncampus'], ['Referral Radar', '/referral'], ['PYQ Practice', '/pyq']].map(([label, href]) => (
                  <li key={href}><Link href={href} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors duration-150">{label}</Link></li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-[var(--text-tertiary)] font-medium mb-4">Contact</p>
              <ul className="space-y-3 text-sm">
                <li><a href="mailto:hello@placeiq.in" className="flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors duration-150"><Mail className="w-3.5 h-3.5" />hello@placeiq.in</a></li>
                <li><span className="flex items-center gap-2 text-[var(--text-secondary)]"><MapPin className="w-3.5 h-3.5" />Chennai, India</span></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-[var(--border-subtle)] flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-xs text-[var(--text-tertiary)]">&copy; 2026 PlaceIQ. All rights reserved.</p>
          <p className="text-xs text-[var(--text-tertiary)]">Built for Indian engineering students</p>
        </div>
      </div>
    </footer>
  );
}
