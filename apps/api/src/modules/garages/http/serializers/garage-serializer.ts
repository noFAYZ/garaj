import type { Garage, GarageMember } from '@vehicle-os/contracts';
import type {
  GarageWithMeta,
  MemberRow,
} from '../../infrastructure/repositories/garage-repository';

export function serializeGarage(garage: GarageWithMeta): Garage {
  return {
    id: garage.id,
    name: garage.name,
    description: garage.description,
    ownerId: garage.ownerId,
    defaultCurrency: garage.defaultCurrency,
    costReporting: garage.costReporting,
    vehicleCount: garage.vehicleCount,
    role: garage.role,
    createdAt: garage.createdAt.toISOString(),
    updatedAt: garage.updatedAt.toISOString(),
  };
}

export function serializeMember(member: MemberRow): GarageMember {
  return {
    id: member.id,
    userId: member.userId,
    email: member.email,
    name: member.name,
    image: member.image,
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
    vehicleIds: member.vehicleIds,
  };
}
