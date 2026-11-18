import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env';
import { requireAdmin, requireAuth } from '../middleware/auth';

export const referralsRouter = Router();

const getAdminClient = () => {
  if (!isSupabaseConfigured || !env.supabaseServiceRoleKey) {
    throw new Error('Referral services are not configured.');
  }
  return createClient(env.supabaseUrl!, env.supabaseServiceRoleKey);
};

const displayName = (profile: { first_name?: string | null; last_name?: string | null; full_name?: string | null }) =>
  [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.full_name || 'Customer';

referralsRouter.get('/validate/:code', async (req, res, next) => {
  try {
    const code = req.params.code.toUpperCase();
    if (!/^[A-Z0-9]{3,32}$/.test(code)) return res.json({ data: { valid: false } });
    const client = getAdminClient();
    const { data, error } = await client.from('profiles').select('id').eq('referral_code', code).maybeSingle();
    if (error) throw error;
    return res.json({ data: { valid: Boolean(data) } });
  } catch (error) {
    return next(error);
  }
});

referralsRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const client = getAdminClient();
    const [{ data: profile, error: profileError }, { data: relationships, error: referralError }, { data: ownPackages, error: packageError }, { data: referralSettings, error: settingsError }] = await Promise.all([
      client.from('profiles').select('id,first_name,last_name,full_name,referral_code,referral_discount_eligible').eq('id', req.user!.id).single(),
      client.from('referrals').select('id,referred_id,referral_code,status,created_at,successful_at').eq('referrer_id', req.user!.id).order('created_at', { ascending: false }),
      client.from('packages').select('pricing_breakdown').eq('customer_id', req.user!.id),
      client.from('referral_settings').select('enabled,discount_per_lb,free_delivery_enabled').eq('id', true).single(),
    ]);
    if (profileError) throw profileError;
    if (referralError) throw referralError;
    if (packageError) throw packageError;
    if (settingsError) throw settingsError;

    const referredIds = (relationships ?? []).map((referral) => referral.referred_id);
    const { data: referredProfiles, error: referredError } = referredIds.length
      ? await client.from('profiles').select('id,first_name,last_name,full_name').in('id', referredIds)
      : { data: [], error: null };
    if (referredError) throw referredError;
    const names = new Map((referredProfiles ?? []).map((person) => [person.id, displayName(person)]));
    const totalDiscounts = (ownPackages ?? []).reduce((total, pkg) => total + Number(pkg.pricing_breakdown?.referral_discount_jmd || 0), 0);

    return res.json({
      data: {
        profile: {
          name: displayName(profile),
          referral_code: profile.referral_code,
          discount_eligible: profile.referral_discount_eligible,
          program_enabled: referralSettings.enabled,
          discount_per_lb: referralSettings.discount_per_lb,
          free_delivery_enabled: referralSettings.free_delivery_enabled,
        },
        statistics: {
          total_referred: relationships?.length ?? 0,
          registered: relationships?.filter((item) => item.status === 'registered').length ?? 0,
          awaiting_first_shipment: relationships?.filter((item) => item.status === 'registered').length ?? 0,
          successful: relationships?.filter((item) => item.status === 'successful').length ?? 0,
          benefits_earned_jmd: totalDiscounts,
        },
        referrals: (relationships ?? []).map((referral) => ({
          id: referral.id,
          referred_customer: names.get(referral.referred_id) ?? 'Customer',
          created_at: referral.created_at,
          status: referral.status,
          first_shipment_status: referral.status === 'successful' ? 'Paid shipment completed' : 'Awaiting first paid shipment',
          reward_activated_at: referral.successful_at,
        })),
      },
    });
  } catch (error) {
    return next(error);
  }
});

referralsRouter.get('/management', requireAdmin, async (req, res, next) => {
  try {
    const client = getAdminClient();
    const page = Math.max(0, Number.parseInt(String(req.query.page ?? '0'), 10) || 0);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '50'), 10) || 50));
    const searchTerm = String(req.query.search ?? '').trim().replace(/[^a-zA-Z0-9\s.-]/g, '').slice(0, 60);
    const statusFilter = String(req.query.status ?? 'all');
    let matchingProfileIds: string[] = [];
    if (searchTerm) {
      const { data: matchingProfiles, error: matchingProfilesError } = await client.from('profiles')
        .select('id')
        .or(`full_name.ilike.%${searchTerm}%,first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%,referral_code.ilike.%${searchTerm}%`)
        .limit(10000);
      if (matchingProfilesError) throw matchingProfilesError;
      matchingProfileIds = (matchingProfiles ?? []).map((profile) => profile.id);
    }
    let relationshipQuery = client.from('referrals')
      .select('id,referrer_id,referred_id,referral_code,status,created_at,successful_at', { count: 'exact' })
      .order('created_at', { ascending: false });
    if (searchTerm) {
      const filters = [`referral_code.ilike.%${searchTerm}%`];
      if (matchingProfileIds.length) {
        const ids = matchingProfileIds.join(',');
        filters.push(`referrer_id.in.(${ids})`, `referred_id.in.(${ids})`);
      }
      relationshipQuery = relationshipQuery.or(filters.join(','));
    }
    if (['registered', 'successful', 'revoked'].includes(statusFilter)) {
      relationshipQuery = relationshipQuery.eq('status', statusFilter);
    }
    const [{ data: settings, error: settingsError }, { data: areas, error: areasError }, { data: relationships, count: relationshipCount, error: referralsError }, { data: allRelationships, error: allReferralsError }, { data: profiles, error: profilesError }, { data: packages, error: packagesError }] = await Promise.all([
      client.from('referral_settings').select('*').eq('id', true).single(),
      client.from('referral_delivery_areas').select('*').order('parish').order('community'),
      relationshipQuery.range(page * pageSize, page * pageSize + pageSize - 1),
      client.from('referrals').select('referrer_id,status'),
      client.from('profiles').select('id,first_name,last_name,full_name,referral_code,referral_discount_eligible,referral_free_delivery_override,referred_by_id,delivery_preference,city_town,parish,created_at').order('created_at', { ascending: false }),
      client.from('packages').select('customer_id,collection_amount_jmd,pricing_breakdown'),
    ]);
    if (settingsError) throw settingsError;
    if (areasError) throw areasError;
    if (referralsError) throw referralsError;
    if (allReferralsError) throw allReferralsError;
    if (profilesError) throw profilesError;
    if (packagesError) throw packagesError;

    const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    const normalizeLocation = (value: string | null) => (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^saint/, 'st');
    const discounts = (packages ?? []).reduce((sum, pkg) => sum + Number(pkg.pricing_breakdown?.referral_discount_jmd || 0), 0);
    const referredIds = new Set((profiles ?? []).filter((profile) => profile.referred_by_id).map((profile) => profile.id));
    const referredRevenue = (packages ?? []).reduce((sum, pkg) =>
      referredIds.has(pkg.customer_id) ? sum + Number(pkg.collection_amount_jmd || 0) : sum, 0);
    const byReferrer = new Map<string, number>();
    (allRelationships ?? []).filter((item) => item.status === 'successful').forEach((item) =>
      byReferrer.set(item.referrer_id, (byReferrer.get(item.referrer_id) ?? 0) + 1));
    const topReferrers = [...byReferrer.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([id, successful_referrals]) => ({
        customer: displayName(profileMap.get(id) ?? {}),
        referral_code: profileMap.get(id)?.referral_code,
        successful_referrals,
      }));

    return res.json({
      data: {
        settings,
        areas: areas ?? [],
        statistics: {
          total_codes: profiles?.length ?? 0,
          registered_referrals: relationshipCount ?? 0,
          successful_referrals: (allRelationships ?? []).filter((item) => item.status === 'successful').length,
          pending_activations: (allRelationships ?? []).filter((item) => item.status === 'registered').length,
          eligible_customers: (profiles ?? []).filter((profile) => profile.referral_discount_eligible).length,
          discounts_applied_jmd: discounts,
          referred_shipping_revenue_jmd: referredRevenue,
          top_referrers: topReferrers,
        },
        referrals: (relationships ?? []).map((referral) => {
          const referrer = profileMap.get(referral.referrer_id);
          const referred = profileMap.get(referral.referred_id);
          return {
            id: referral.id,
            referrer_id: referral.referrer_id,
            referred_id: referral.referred_id,
            referrer: displayName(referrer ?? {}),
            referrer_code: referrer?.referral_code ?? referral.referral_code,
            referred_customer: displayName(referred ?? {}),
            registered_at: referral.created_at,
            status: referral.status,
            first_paid_shipment_at: referral.successful_at,
            discount_eligible: Boolean(referred?.referral_discount_eligible),
            referrer_eligible: Boolean(referrer?.referral_discount_eligible),
          };
        }),
        customers: (profiles ?? []).map((profile) => ({
          id: profile.id,
          name: displayName(profile),
          referral_code: profile.referral_code,
          discount_eligible: profile.referral_discount_eligible,
          free_delivery_override: profile.referral_free_delivery_override,
          city_town: profile.city_town,
          parish: profile.parish,
          free_delivery_eligible: Boolean(settings.free_delivery_enabled
            && profile.delivery_preference === 'delivery'
            && (profile.referral_free_delivery_override ?? Boolean(profile.referred_by_id))
            && (areas ?? []).some((area) => area.enabled
              && normalizeLocation(area.community) === normalizeLocation(profile.city_town)
              && normalizeLocation(area.parish) === normalizeLocation(profile.parish))),
          referred_by_id: profile.referred_by_id,
          created_at: profile.created_at,
        })),
        page,
        page_size: pageSize,
        total_referrals: relationshipCount ?? 0,
      },
    });
  } catch (error) {
    return next(error);
  }
});

referralsRouter.patch('/management/settings', requireAdmin, async (req, res, next) => {
  try {
    const { enabled, discount_per_lb: discountPerLb, referrer_activation: referrerActivation, free_delivery_enabled: freeDeliveryEnabled } = req.body as Record<string, unknown>;
    if (typeof enabled !== 'boolean' || typeof freeDeliveryEnabled !== 'boolean'
      || typeof discountPerLb !== 'number' || !Number.isFinite(discountPerLb) || discountPerLb < 0
      || !['registration', 'first_paid_shipment'].includes(String(referrerActivation))) {
      return res.status(400).json({ error: 'Referral settings are invalid.' });
    }
    const client = getAdminClient();
    const { data, error } = await client.from('referral_settings').update({
      enabled,
      discount_per_lb: discountPerLb,
      referrer_activation: referrerActivation,
      free_delivery_enabled: freeDeliveryEnabled,
      updated_by: req.user!.id,
    }).eq('id', true).select().single();
    if (error) throw error;
    const { error: auditError } = await client.from('audit_logs').insert({
      actor_id: req.user!.id,
      action: 'referral_settings_updated',
      entity_type: 'referral_settings',
      metadata: { enabled, discount_per_lb: discountPerLb, referrer_activation: referrerActivation, free_delivery_enabled: freeDeliveryEnabled },
    });
    if (auditError) throw auditError;
    return res.json({ data });
  } catch (error) {
    return next(error);
  }
});

referralsRouter.post('/management/areas', requireAdmin, async (req, res, next) => {
  try {
    const { community, parish } = req.body as { community?: unknown; parish?: unknown };
    if (typeof community !== 'string' || !community.trim() || typeof parish !== 'string' || !parish.trim()) {
      return res.status(400).json({ error: 'Community and parish are required.' });
    }
    const client = getAdminClient();
    const area = { community: community.trim(), parish: parish.trim(), enabled: true };
    const { data, error } = await client.from('referral_delivery_areas').upsert(area, { onConflict: 'community,parish' }).select().single();
    if (error) throw error;
    const { error: auditError } = await client.from('audit_logs').insert({
      actor_id: req.user!.id, action: 'referral_delivery_area_added', entity_type: 'referral_delivery_area', entity_id: data.id, metadata: area,
    });
    if (auditError) throw auditError;
    return res.status(201).json({ data });
  } catch (error) {
    return next(error);
  }
});

referralsRouter.delete('/management/areas/:areaId', requireAdmin, async (req, res, next) => {
  try {
    const client = getAdminClient();
    const { data: area, error: findError } = await client.from('referral_delivery_areas').select('id,community,parish').eq('id', req.params.areaId).single();
    if (findError) throw findError;
    const { error } = await client.from('referral_delivery_areas').delete().eq('id', req.params.areaId);
    if (error) throw error;
    const { error: auditError } = await client.from('audit_logs').insert({
      actor_id: req.user!.id, action: 'referral_delivery_area_removed', entity_type: 'referral_delivery_area', entity_id: area.id, metadata: area,
    });
    if (auditError) throw auditError;
    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

referralsRouter.patch('/management/customers/:customerId', requireAdmin, async (req, res, next) => {
  try {
    const { discount_eligible: discountEligible, free_delivery_override: freeDeliveryOverride } = req.body as Record<string, unknown>;
    if (discountEligible !== undefined && typeof discountEligible !== 'boolean') {
      return res.status(400).json({ error: 'Discount eligibility must be true or false.' });
    }
    if (freeDeliveryOverride !== undefined && freeDeliveryOverride !== null && typeof freeDeliveryOverride !== 'boolean') {
      return res.status(400).json({ error: 'Free delivery override must be true, false, or null.' });
    }
    if (discountEligible === undefined && freeDeliveryOverride === undefined) {
      return res.status(400).json({ error: 'No eligibility changes were provided.' });
    }
    const client = getAdminClient();
    const { data: before, error: beforeError } = await client.from('profiles')
      .select('id,referred_by_id')
      .eq('id', req.params.customerId)
      .single();
    if (beforeError) throw beforeError;
    const values: Record<string, unknown> = {};
    if (discountEligible !== undefined) {
      values.referral_discount_eligible = discountEligible;
      values.referral_activated_at = discountEligible ? new Date().toISOString() : null;
    }
    if (freeDeliveryOverride !== undefined) values.referral_free_delivery_override = freeDeliveryOverride;
    const { data, error } = await client.from('profiles').update(values).eq('id', req.params.customerId)
      .select('id,referral_discount_eligible,referral_free_delivery_override').single();
    if (error) throw error;
    if (discountEligible !== undefined && before.referred_by_id) {
      const { error: referralUpdateError } = await client.from('referrals').update({
        status: discountEligible ? 'successful' : 'revoked',
        successful_at: discountEligible ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq('referred_id', req.params.customerId);
      if (referralUpdateError) throw referralUpdateError;
    }
    const { error: auditError } = await client.from('audit_logs').insert({
      actor_id: req.user!.id,
      action: 'referral_customer_eligibility_updated',
      entity_type: 'profile',
      entity_id: req.params.customerId,
      metadata: values,
    });
    if (auditError) throw auditError;
    return res.json({ data });
  } catch (error) {
    return next(error);
  }
});
