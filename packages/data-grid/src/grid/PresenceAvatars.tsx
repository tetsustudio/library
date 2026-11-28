'use client';

export interface PresenceAvatarUser {
    userId: number;
    name: string;
    color: string;
    editing?: boolean;
}

const initials = (name: string) =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

/** Overlapping circles with the initials of the users who have the sheet open ("+N" past `max`). */
export function PresenceAvatars({ users, max = 4, label, editingLabel }: {
    users: PresenceAvatarUser[];
    max?: number;
    label: string;
    editingLabel: (name: string) => string;
}) {
    if (users.length === 0) return null;
    const shown = users.slice(0, max);
    const rest = users.length - shown.length;
    return (
        <div className="tds-avatars" aria-label={label}>
            {shown.map((u) => (
                <span key={u.userId} title={u.editing ? editingLabel(u.name) : u.name} data-testid="presence-avatar"
                    className="tds-avatar" style={{ backgroundColor: u.color }}>
                    {initials(u.name)}
                </span>
            ))}
            {rest > 0 && (
                <span title={users.slice(max).map((u) => u.name).join(', ')} className="tds-avatar tds-avatar--rest">+{rest}</span>
            )}
        </div>
    );
}
