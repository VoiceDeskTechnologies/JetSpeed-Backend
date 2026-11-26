import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from '../config/env';
import { requireStaff } from '../middleware/auth';

export const packageProcessingRouter = Router();

packageProcessingRouter.patch('/:packageId', requireStaff, async (req, res, next) => {
  try {
    if (!isSupabaseConfigured || !env.supabaseServiceRoleKey) {
      return res.status(503).json({ error: 'Package processing is not configured.' });
    }
    const { status, weight_lb: weightLb, freight_type: freightType, custom_amount_jmd: customAmountJmd } = req.body as {
      status?: unknown;
      weight_lb?: unknown;
      freight_type?: unknown;
      custom_amount_jmd?: unknown;
    };
    if (typeof status !== 'string' || typeof freightType !== 'string'
      || (weightLb !== null && weightLb !== undefined && (typeof weightLb !== 'number' || !Number.isFinite(weightLb)))
      || (customAmountJmd !== null && customAmountJmd !== undefined && (typeof customAmountJmd !== 'number' || !Number.isFinite(customAmountJmd) || customAmountJmd < 0))) {
      return res.status(400).json({ error: 'A valid package status, weight, freight type, and custom amount are required.' });
    }

    const client = createClient(env.supabaseUrl!, env.supabaseServiceRoleKey);
    const { data: result, error } = await client.rpc('admin_update_package', {
      p_package_id: req.params.packageId,
      p_status: status,
      p_weight_lb: weightLb ?? null,
      p_freight_type: freightType,
      p_custom_amount_jmd: customAmountJmd ?? null,
      p_actor_id: req.user!.id,
    });
    if (error) return res.status(400).json({ error: error.message });

    const previousStatus = result.previous_status as string;
    const warnings: string[] = [];
    if (status === 'ready_for_pickup') {
      const { error: invoiceError } = await client.rpc('ensure_current_shipping_invoice', {
        p_package_id: req.params.packageId,
      });
      if (invoiceError) {
        warnings.push(`Package is ready, but its shipping invoice could not be saved: ${invoiceError.message}`);
      }
    }
    const statusLabels: Record<string, string> = {
      label_created: 'Label created',
      received_at_miami: 'Received at Miami hub',
      in_transit: 'In transit',
      ready_for_pickup: 'Ready for pickup/Delivery',
      delivered: 'Delivered',
    };
    if (status !== previousStatus) {
      const { error: eventError } = await client.from('tracking_events').insert({
        package_id: req.params.packageId,
        status,
        description: statusLabels[status],
        location: status === 'received_at_miami' ? 'Miami hub' : status === 'in_transit' ? 'In transit' : 'Global Xend JA network',
      });
      if (eventError) warnings.push(`Package updated, but tracking history could not be saved: ${eventError.message}`);
    }

    return res.json({ data: result, warnings });
  } catch (error) {
    return next(error);
  }
});
