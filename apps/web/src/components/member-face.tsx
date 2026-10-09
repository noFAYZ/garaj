import { avatarFor, type GarageMember } from '@vehicle-os/contracts';

/**
 * A garage member's face — the one they picked, else the one their account id draws. Sized,
 * rounded and ringed by the slot it sits in — a stack in a header, a row in a list, a tile in a
 * dialog — so the slot decides and this fills it.
 */
export function Face({ member }: { member: Pick<GarageMember, 'userId' | 'image'> }) {
  return (
    <img
      src={avatarFor({ id: member.userId, image: member.image })}
      alt=""
      className="size-full object-cover"
    />
  );
}
