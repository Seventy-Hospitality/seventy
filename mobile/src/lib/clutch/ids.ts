/**
 * Branded id types. Clutch ids are all UUID strings, and the old app confused
 * a venue ("club" in Clutch) with a member social group ("club" in the old
 * app). Branding makes passing a GroupId where a ClubId is expected (or a
 * user id where a booking id is expected) a compile error.
 *
 * Ids enter the app only through the contract schemas (which brand them on
 * parse) or through these `as*` constructors for values from config, route
 * params and deep links.
 */
import { z } from 'zod';

export const ClubIdSchema = z.string().brand<'ClubId'>();
export const GroupIdSchema = z.string().brand<'GroupId'>();
export const UserIdSchema = z.string().brand<'UserId'>();
export const BookingIdSchema = z.string().brand<'BookingId'>();
export const CourtIdSchema = z.string().brand<'CourtId'>();
export const TierIdSchema = z.string().brand<'TierId'>();
export const GroupInvitationIdSchema = z.string().brand<'GroupInvitationId'>();
export const CardIdSchema = z.string().brand<'CardId'>();

export type ClubId = z.infer<typeof ClubIdSchema>;
export type GroupId = z.infer<typeof GroupIdSchema>;
export type UserId = z.infer<typeof UserIdSchema>;
export type BookingId = z.infer<typeof BookingIdSchema>;
export type CourtId = z.infer<typeof CourtIdSchema>;
export type TierId = z.infer<typeof TierIdSchema>;
export type GroupInvitationId = z.infer<typeof GroupInvitationIdSchema>;
export type CardId = z.infer<typeof CardIdSchema>;

export const asClubId = (id: string) => id as ClubId;
export const asGroupId = (id: string) => id as GroupId;
export const asUserId = (id: string) => id as UserId;
export const asBookingId = (id: string) => id as BookingId;
export const asCourtId = (id: string) => id as CourtId;
export const asTierId = (id: string) => id as TierId;
export const asGroupInvitationId = (id: string) => id as GroupInvitationId;
export const asCardId = (id: string) => id as CardId;
