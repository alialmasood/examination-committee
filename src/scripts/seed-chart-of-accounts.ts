/**
 * Seed آمن لدليل حسابات كلية الشرق التقنية التخصصية.
 *
 * الوضع الافتراضي: dry-run / تحقق فقط (لا إدراج).
 * التنفيذ الفعلي:
 *   npm run seed:accounts-chart:execute
 *   أو: npm run seed:accounts-chart -- --execute
 *
 * - لا يُشغَّل من npm run migrate
 * - INSERT فقط للحسابات غير الموجودة (حسب الكود)
 * - لا يعدّل حسابات موجودة (اسم، أب، حالة، رصيد، مركز كلفة، …)
 */
import { closePool, query } from '../lib/db';
import { COLLEGE_CHART_SEED } from '../lib/accounts/chart-seed-data';
import { nextSiblingSortOrder, resolveGroupPostingFlags } from '../lib/accounts/chart-of-accounts';
import { txQuery, withTransaction } from '../lib/accounts/with-transaction';

type ExistingAccount = {
  id: string;
  code: string;
  parent_id: string | null;
  source: string;
};

type ValidationIssue = {
  code: string;
  kind: 'missing_type' | 'missing_parent' | 'duplicate_in_seed' | 'invalid_sort';
  message: string;
};

function parseArgs(argv: string[]) {
  const execute =
    argv.includes('--execute') ||
    argv.includes('-x') ||
    process.env.SEED_ACCOUNTS_CHART_EXECUTE === '1';
  const dryRun = !execute;
  return { execute, dryRun };
}

async function resolveSeedUserId(): Promise<string> {
  const linked = await query(
    `SELECT u.id
     FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id = u.id
     JOIN student_affairs.systems s ON s.id = us.system_id
     WHERE s.code = 'ACCOUNTS' AND u.is_active = TRUE
     ORDER BY u.username
     LIMIT 1`
  );
  if (linked.rows.length > 0) return linked.rows[0].id as string;

  const anyUser = await query(
    `SELECT id FROM student_affairs.users WHERE is_active = TRUE ORDER BY created_at LIMIT 1`
  );
  if (anyUser.rows.length === 0) {
    throw new Error('لا يوجد مستخدم نشط لاستخدامه في created_by');
  }
  return anyUser.rows[0].id as string;
}

async function ensureSchemaReady() {
  const cols = await query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'accounts'
       AND table_name = 'chart_of_accounts'
       AND column_name IN ('source', 'sort_order')`
  );
  const names = new Set(cols.rows.map((r) => r.column_name as string));
  if (!names.has('source') || !names.has('sort_order')) {
    throw new Error(
      'أعمدة source/sort_order غير موجودة — شغّل: npm run migrate (migration 060)'
    );
  }
}

function validateSeedStructure(
  typeByCode: Map<string, { id: string; normal_balance: string }>,
  existingByCode: Map<string, ExistingAccount>
): {
  issues: ValidationIssue[];
  toInsert: typeof COLLEGE_CHART_SEED;
  toSkip: Array<{ code: string; name_ar: string; source: string }>;
} {
  const issues: ValidationIssue[] = [];
  const seenInSeed = new Set<string>();
  const toInsert: typeof COLLEGE_CHART_SEED = [];
  const toSkip: Array<{ code: string; name_ar: string; source: string }> = [];

  for (const def of COLLEGE_CHART_SEED) {
    const codeKey = def.code.toUpperCase();

    if (seenInSeed.has(codeKey)) {
      issues.push({
        code: def.code,
        kind: 'duplicate_in_seed',
        message: `تكرار الكود داخل ملف الـ seed: ${def.code}`,
      });
      continue;
    }
    seenInSeed.add(codeKey);

    if (!typeByCode.has(def.type)) {
      issues.push({
        code: def.code,
        kind: 'missing_type',
        message: `نوع الحساب غير موجود: ${def.type} للحساب ${def.code}`,
      });
    }

    if (def.sort_order == null || def.sort_order < 1) {
      issues.push({
        code: def.code,
        kind: 'invalid_sort',
        message: `sort_order غير صالح للحساب ${def.code}`,
      });
    }

    if (existingByCode.has(codeKey)) {
      const ex = existingByCode.get(codeKey)!;
      toSkip.push({
        code: def.code,
        name_ar: def.name_ar,
        source: ex.source || '?',
      });
    } else {
      toInsert.push(def);
    }
  }

  // محاكاة ترتيب الإدراج للتحقق من توفر الأب قبل الابن
  const simParents = new Set<string>([...existingByCode.keys()]);
  for (const def of COLLEGE_CHART_SEED) {
    const codeKey = def.code.toUpperCase();
    if (existingByCode.has(codeKey)) {
      simParents.add(codeKey);
      continue;
    }
    if (!typeByCode.has(def.type)) continue;
    if (def.parent_code) {
      const pk = def.parent_code.toUpperCase();
      if (!simParents.has(pk)) {
        issues.push({
          code: def.code,
          kind: 'missing_parent',
          message: `تعارض بنيوي: الأب ${def.parent_code} غير متاح قبل إدراج ${def.code}`,
        });
        continue;
      }
    }
    simParents.add(codeKey);
  }

  const uniq = new Map<string, ValidationIssue>();
  for (const issue of issues) {
    uniq.set(`${issue.kind}:${issue.code}:${issue.message}`, issue);
  }

  return {
    issues: [...uniq.values()],
    toInsert,
    toSkip,
  };
}

function printReport(opts: {
  dryRun: boolean;
  toInsert: typeof COLLEGE_CHART_SEED;
  toSkip: Array<{ code: string; name_ar: string; source: string }>;
  issues: ValidationIssue[];
}) {
  console.log('');
  console.log('══════════════════════════════════════════');
  console.log(opts.dryRun ? '🔎 وضع التحقق (dry-run) — بلا إدراج' : '🚀 وضع التنفيذ (--execute)');
  console.log('══════════════════════════════════════════');
  console.log(`تعريفات الـ seed الإجمالية: ${COLLEGE_CHART_SEED.length}`);
  console.log(`سيُنشأ (جديد):              ${opts.toInsert.length}`);
  console.log(`سيُتجاوز (موجود مسبقاً):     ${opts.toSkip.length}`);
  console.log(`تعارضات بنيوية:             ${opts.issues.length}`);

  if (opts.toSkip.length > 0) {
    console.log('');
    console.log('— حسابات موجودة سيتم تجاوزها (بدون تعديل) —');
    const preview = opts.toSkip.slice(0, 30);
    for (const s of preview) {
      console.log(`  • ${s.code} — ${s.name_ar} [source=${s.source}]`);
    }
    if (opts.toSkip.length > 30) {
      console.log(`  … و ${opts.toSkip.length - 30} حساباً إضافياً`);
    }
  }

  if (opts.toInsert.length > 0) {
    console.log('');
    console.log('— حسابات متوقع إنشاؤها —');
    const preview = opts.toInsert.slice(0, 30);
    for (const d of preview) {
      console.log(
        `  + ${d.code} — ${d.name_ar}` +
          (d.parent_code ? ` (أب: ${d.parent_code})` : ' (جذر)') +
          ` sort=${d.sort_order}`
      );
    }
    if (opts.toInsert.length > 30) {
      console.log(`  … و ${opts.toInsert.length - 30} حساباً إضافياً`);
    }
  }

  if (opts.issues.length > 0) {
    console.log('');
    console.log('— تعارضات تمنع التنفيذ —');
    for (const issue of opts.issues) {
      console.log(`  ✗ [${issue.kind}] ${issue.message}`);
    }
  }
  console.log('══════════════════════════════════════════');
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));

  console.log('🌱 Seed دليل الحسابات — كلية الشرق التقنية التخصصية');
  if (dryRun) {
    console.log('ℹ️  الافتراضي dry-run. للتنفيذ: npm run seed:accounts-chart:execute');
  }

  await ensureSchemaReady();

  const typesRes = await query(
    `SELECT id, code, normal_balance FROM accounts.account_types WHERE is_active = TRUE`
  );
  const typeByCode = new Map<string, { id: string; normal_balance: string }>();
  for (const row of typesRes.rows) {
    typeByCode.set(String(row.code).toUpperCase(), {
      id: row.id,
      normal_balance: row.normal_balance,
    });
  }

  for (const required of ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']) {
    if (!typeByCode.has(required)) {
      throw new Error(`نوع الحساب ${required} غير موجود — شغّل migration 059 أولاً`);
    }
  }

  const existingRes = await query(
    `SELECT id, code, parent_id, source FROM accounts.chart_of_accounts`
  );
  const existingByCode = new Map<string, ExistingAccount>();
  for (const row of existingRes.rows) {
    existingByCode.set(String(row.code).toUpperCase(), {
      id: row.id as string,
      code: row.code as string,
      parent_id: row.parent_id as string | null,
      source: String(row.source || 'USER'),
    });
  }

  const { issues, toInsert, toSkip } = validateSeedStructure(typeByCode, existingByCode);
  printReport({ dryRun, toInsert, toSkip, issues });

  if (issues.length > 0) {
    console.error('❌ فشل التحقق بسبب تعارض بنيوي. لم يُنفَّذ أي إدراج.');
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log('✅ التحقق ناجح. لم يُدرج شيء (dry-run).');
    console.log('   شغّل التنفيذ عند الجاهزية:');
    console.log('   npm run seed:accounts-chart:execute');
    return;
  }

  if (toInsert.length === 0) {
    console.log('✅ لا حسابات جديدة للإدراج. تم التجاوز بالكامل.');
    return;
  }

  const userId = await resolveSeedUserId();
  console.log('👤 created_by =', userId);

  const result = await withTransaction(async (client) => {
    const idByCode = new Map<string, string>();
    for (const [k, v] of existingByCode) {
      idByCode.set(k, v.id);
    }

    let inserted = 0;
    const insertedCodes: string[] = [];

    for (const def of toInsert) {
      const codeKey = def.code.toUpperCase();
      // حماية إضافية ضد سباق/تكرار
      if (idByCode.has(codeKey)) continue;

      const type = typeByCode.get(def.type)!;
      let parentId: string | null = null;
      let level = 1;
      if (def.parent_code) {
        parentId = idByCode.get(def.parent_code.toUpperCase()) || null;
        if (!parentId) {
          throw new Error(`الأب ${def.parent_code} غير موجود قبل الابن ${def.code}`);
        }
        const parentLevel = await txQuery<{ level: number }>(
          client,
          `SELECT level FROM accounts.chart_of_accounts WHERE id = $1`,
          [parentId]
        );
        level = Number(parentLevel.rows[0].level) + 1;
      }

      const flags = resolveGroupPostingFlags(def.is_group);
      const normalBalance = def.normal_balance || type.normal_balance;

      let sortOrder = def.sort_order || 1;
      const sortTaken = await txQuery<{ id: string }>(
        client,
        `SELECT id FROM accounts.chart_of_accounts
         WHERE parent_id IS NOT DISTINCT FROM $1::uuid AND sort_order = $2
         LIMIT 1`,
        [parentId, sortOrder]
      );
      if (sortTaken.rows.length > 0) {
        sortOrder = await nextSiblingSortOrder(client, parentId);
      }

      const ins = await txQuery<{ id: string }>(
        client,
        `INSERT INTO accounts.chart_of_accounts
          (code, name_ar, name_en, account_type_id, parent_id, level, is_group, allow_posting,
           normal_balance, requires_cost_center, is_active, description, source, sort_order,
           created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,NULL,'SYSTEM',$11,$12,$12)
         RETURNING id`,
        [
          def.code,
          def.name_ar,
          def.name_en || null,
          type.id,
          parentId,
          level,
          flags.is_group,
          flags.allow_posting,
          normalBalance,
          def.requires_cost_center,
          sortOrder,
          userId,
        ]
      );

      idByCode.set(codeKey, ins.rows[0].id);
      inserted += 1;
      insertedCodes.push(def.code);
    }

    await txQuery(
      client,
      `INSERT INTO accounts.financial_audit_log
        (user_id, action, entity_type, entity_id, new_values, description)
       VALUES ($1, 'chart_account.seed', 'chart_of_accounts', $2::uuid, $3::jsonb, $4)`,
      [
        userId,
        '00000000-0000-4000-8000-000000000060',
        JSON.stringify({
          inserted,
          skipped: toSkip.length,
          total_seed_defs: COLLEGE_CHART_SEED.length,
          inserted_codes: insertedCodes,
        }),
        `تشغيل seed دليل الحسابات: أُضيف ${inserted}، تُخطي ${toSkip.length}`,
      ]
    );

    return { inserted };
  });

  const totals = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE source = 'SYSTEM')::int AS system_count,
            COUNT(*) FILTER (WHERE source = 'USER')::int AS user_count
     FROM accounts.chart_of_accounts`
  );

  console.log('✅ اكتمل التنفيذ');
  console.log(`   أُضيف: ${result.inserted}`);
  console.log(`   تُخطي: ${toSkip.length}`);
  console.log(
    `   الإجمالي في DB: ${totals.rows[0].total} (SYSTEM=${totals.rows[0].system_count}, USER=${totals.rows[0].user_count})`
  );
}

main()
  .catch((err) => {
    console.error('❌ فشل Seed دليل الحسابات:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
