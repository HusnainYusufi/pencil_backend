import type { Contact, Tenant } from '../../generated/prisma/client.js';
import type { PartySnapshot } from './einvoicing.types.js';

/** The company as seller, as printed on its documents. */
export function sellerFromTenant(tenant: Tenant): PartySnapshot {
  return {
    type: 'BUSINESS',
    name: tenant.legalName,
    nameAr: null,
    vatNumber: tenant.taxNumber,
    idScheme: tenant.commercialRegistration ? 'CRN' : null,
    idNumber: tenant.commercialRegistration,
    address: {
      street: tenant.addressStreet,
      buildingNumber: tenant.addressBuildingNumber,
      additionalNumber: tenant.addressAdditionalNumber,
      district: tenant.addressDistrict,
      city: tenant.addressCity,
      postalCode: tenant.addressPostalCode,
      region: tenant.addressRegion,
      country: tenant.country,
    },
    email: null,
    phone: null,
  };
}

/** A customer as buyer. Contacts without an address country are in the company's country. */
export function buyerFromContact(contact: Contact, defaultCountry: string): PartySnapshot {
  const hasAddress = [
    contact.addressStreet,
    contact.addressBuildingNumber,
    contact.addressDistrict,
    contact.addressCity,
    contact.addressPostalCode,
    contact.addressCountry,
  ].some(Boolean);
  return {
    type: contact.type,
    name: contact.name,
    nameAr: contact.nameAr,
    vatNumber: contact.taxNumber,
    idScheme: contact.idScheme,
    idNumber: contact.idNumber,
    address: hasAddress
      ? {
          street: contact.addressStreet,
          buildingNumber: contact.addressBuildingNumber,
          additionalNumber: contact.addressAdditionalNumber,
          district: contact.addressDistrict,
          city: contact.addressCity,
          postalCode: contact.addressPostalCode,
          region: contact.addressRegion,
          country: contact.addressCountry ?? defaultCountry,
        }
      : null,
    email: contact.email,
    phone: contact.phone,
  };
}
