'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Channel = 'systemNotification' | 'systemAlert' | 'email' | 'whatsapp' | 'sms';

interface BulkNotificationForm {
  title: string;
  message: string;
  audienceType: 'all' | 'department' | 'stage' | 'semester' | 'newStudents' | 'custom';
  selectedDepartments: string[];
  selectedStage: string;
  selectedSemester: string;
  customStudents: string[];
  channels: Channel[];
  priority: 'low' | 'medium' | 'high' | 'urgent';
}

interface IndividualMessageForm {
  studentId: string;
  studentName: string;
  subject: string;
  message: string;
  messageType: 'notification' | 'warning' | 'reminder' | 'announcement';
  channels: Channel[];
  priority: 'low' | 'medium' | 'high' | 'urgent';
  attachments?: File[];
  scheduledDate?: string;
  scheduledTime?: string;
  isScheduled: boolean;
}

interface NotificationSettings {
  emailNotifications: boolean;
  systemNotifications: boolean;
  pushNotifications: boolean;
  smsNotifications: boolean;
  notificationTypes: {
    academic: boolean;
    administrative: boolean;
    financial: boolean;
    events: boolean;
    warnings: boolean;
    reminders: boolean;
  };
  quietHours: {
    enabled: boolean;
    startTime: string;
    endTime: string;
  };
  language: 'ar' | 'en';
  autoSyncExternalSystems: boolean;
}

interface DepartmentOption {
  id: string;
  name: string;
  count: number;
}

interface DepartmentStageSummaryEntry {
  id: string;
  name: string;
  order: number;
  rawAdmissionType: string | null;
  total: number;
  semesters: SemesterOption[];
}

interface SemesterOption {
  id: string;
  name: string;
  raw: string | null;
  count: number;
}

interface StageOption {
  id: string;
  name: string;
  total: number;
  rawAdmissionType: string | null;
  order: number;
  semesters: SemesterOption[];
}

interface CommunicationsMetadata {
  departments: DepartmentOption[];
  stages: StageOption[];
  departmentStages: Record<string, DepartmentStageSummaryEntry[]>;
  totals: {
    totalStudents: number;
  };
  newStudentsCount: number;
}

interface CampaignDeliveryDetail {
  recipient: string | null;
  status: 'success' | 'failed';
  errorMessage?: string | null;
  createdAt: string;
}

interface CampaignRecipient {
  id: string;
  name: string | null;
  phone: string;
}

interface StudentQuickPick {
  id: string;
  name: string;
  phone: string;
  department?: string | null;
  stage?: string | null;
}

interface CampaignChannelSummary {
  id: string;
  channelType: string;
  status: string;
  senderProfile?: string | null;
  lastError?: string | null;
  lastAttemptAt?: string | null;
  updatedAt?: string | null;
  successCount: number;
  failedCount: number;
  lastDeliveryAt?: string | null;
  deliveries: CampaignDeliveryDetail[];
}

interface CampaignSummary {
  id: string;
  title: string;
  message: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  audienceType: string;
  customRecipients: string[];
  status: string;
  totalRecipients?: number | null;
  createdAt: string;
  updatedAt?: string | null;
  sentAt?: string | null;
  channels: CampaignChannelSummary[];
  recipients: CampaignRecipient[];
}

const CHANNEL_OPTIONS: Record<Channel, { label: string; description: string; color: string }> = {
  systemNotification: {
    label: 'إشعارات النظام',
    description: 'رسائل تظهر داخل منصة الطلبة ولوحة التحكم.',
    color: 'bg-indigo-100 text-indigo-700 border border-indigo-200'
  },
  systemAlert: {
    label: 'تنبيهات النظام الفورية',
    description: 'تنبيهات عالية الأولوية تظهر كنافذة منبثقة وإشعار حرِج.',
    color: 'bg-red-100 text-red-700 border border-red-200'
  },
  email: {
    label: 'البريد الإلكتروني',
    description: 'رسالة بريد إلكتروني مصممة بقالب رسمي.',
    color: 'bg-emerald-100 text-emerald-700 border border-emerald-200'
  },
  sms: {
    label: 'رسائل نصية قصيرة (SMS)',
    description: 'رسالة نصية فورية عبر مشغّل الاتصالات.',
    color: 'bg-yellow-100 text-yellow-700 border border-yellow-200'
  },
  whatsapp: {
    label: 'واتساب للأعمال',
    description: 'رسالة يتم إرسالها عبر واجهة WhatsApp Business مع تتبع للتسليم.',
    color: 'bg-green-100 text-green-800 border border-green-200'
  }
};

const CHANNEL_LABELS: Record<string, string> = {
  systemNotification: 'إشعارات النظام',
  systemAlert: 'تنبيهات النظام',
  email: 'البريد الإلكتروني',
  whatsapp: 'واتساب',
  sms: 'رسائل نصية قصيرة',
};

const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  processing: 'قيد الإرسال',
  sent: 'مرسلة',
  failed: 'فشل',
  scheduled: 'مجدولة',
  cancelled: 'ملغاة',
};

const AUDIENCE_TYPE_LABELS: Record<string, string> = {
  all: 'جميع الطلبة',
  department: 'أقسام محددة',
  stage: 'مرحلة دراسية',
  semester: 'فصل دراسي',
  newStudents: 'الطلبة الجدد',
  custom: 'قائمة مخصصة',
};

const BULK_CREATION_STEPS: Array<{ id: 1 | 2 | 3; title: string; description: string }> = [
  {
    id: 1,
    title: 'اختيار قناة المراسلة',
    description: 'حدد وسيلة الإرسال الأنسب للحملة الحالية (واتساب، بريد، SMS أو إشعارات).',
  },
  {
    id: 2,
    title: 'تحديد الجمهور المستهدف',
    description: 'اختر الأقسام أو المراحل أو الطلبة المخصصين الذين تريد مراسلتهم.',
  },
  {
    id: 3,
    title: 'كتابة المحتوى ومراجعة المستلمين',
    description: 'صِغ رسالة الحملة، عيّن الأولوية، واستعرض قائمة المستلمين قبل الإطلاق.',
  },
];

const PRIMARY_CHANNEL_CANDIDATES: Channel[] = ['whatsapp', 'sms', 'email', 'systemNotification'];

const toggleInArray = <T,>(current: T[], value: T) =>
  current.includes(value) ? current.filter((item) => item !== value) : [...current, value];

type ActiveTab = 'bulk' | 'individual' | 'orgUnits' | 'faculty' | 'settings' | 'history';

export default function CommunicationsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('bulk');
  const [showBulkForm, setShowBulkForm] = useState(false);
  const [showIndividualForm, setShowIndividualForm] = useState(false);
  const [showSettingsForm, setShowSettingsForm] = useState(false);
  const [metadata, setMetadata] = useState<CommunicationsMetadata>({
    departments: [],
    stages: [],
    departmentStages: {},
    totals: {
      totalStudents: 0,
    },
    newStudentsCount: 0,
  });
  const [isMetadataLoading, setIsMetadataLoading] = useState(true);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [isSavingCampaign, setIsSavingCampaign] = useState(false);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [campaignSuccess, setCampaignSuccess] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState<string | null>(null);
  const [manualSendingKey, setManualSendingKey] = useState<string | null>(null);
  const [bulkStep, setBulkStep] = useState<1 | 2 | 3>(1);
  const [bulkData, setBulkData] = useState<BulkNotificationForm>({
    title: '',
    message: '',
    audienceType: 'all',
    selectedDepartments: [],
    selectedStage: '',
    selectedSemester: '',
    customStudents: [],
    channels: [],
    priority: 'medium'
  });
  const [audiencePreview, setAudiencePreview] = useState<CampaignRecipient[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [customSearchQuery, setCustomSearchQuery] = useState('');
  const [isCustomSearchLoading, setIsCustomSearchLoading] = useState(false);
  const [customSearchResults, setCustomSearchResults] = useState<StudentQuickPick[]>([]);
  const [customSelectedStudents, setCustomSelectedStudents] = useState<StudentQuickPick[]>([]);
  const customSearchAbortRef = useRef<AbortController | null>(null);
  const previewSignatureRef = useRef<string | null>(null);
  const [expandedCampaignIds, setExpandedCampaignIds] = useState<string[]>([]);

  const getDepartmentStageOptions = useCallback(
    (departmentIds: string[]): StageOption[] => {
      if (!departmentIds.length) {
        return metadata.stages;
      }

      const accumulator = new Map<
        string,
        {
          id: string;
          name: string;
          order: number;
          rawAdmissionType: string | null;
          total: number;
          semesters: Map<string, { id: string; name: string; raw: string | null; count: number }>;
        }
      >();

      departmentIds.forEach((departmentId) => {
        const stageEntries = metadata.departmentStages[departmentId] || [];
        stageEntries.forEach((stage) => {
          const existing = accumulator.get(stage.id);
          if (existing) {
            existing.total += stage.total;
            stage.semesters.forEach((semester) => {
              const semesterEntry = existing.semesters.get(semester.id) || {
                id: semester.id,
                name: semester.name,
                raw: semester.raw,
                count: 0,
              };
              semesterEntry.count += semester.count;
              existing.semesters.set(semester.id, semesterEntry);
            });
          } else {
            const metadataStage = metadata.stages.find((item) => item.id === stage.id);
            const entry = {
              id: stage.id,
              name: stage.name,
              order: metadataStage?.order ?? stage.order ?? 99,
              rawAdmissionType: stage.rawAdmissionType ?? metadataStage?.rawAdmissionType ?? null,
              total: stage.total,
              semesters: new Map<string, { id: string; name: string; raw: string | null; count: number }>(),
            };
            stage.semesters.forEach((semester) => {
              entry.semesters.set(semester.id, {
                id: semester.id,
                name: semester.name,
                raw: semester.raw,
                count: semester.count,
              });
            });
            accumulator.set(stage.id, entry);
          }
        });
      });

      if (!accumulator.size) {
        return metadata.stages;
      }

      return Array.from(accumulator.values())
        .map((entry) => ({
          id: entry.id,
          name: entry.name,
          total: entry.total,
          rawAdmissionType: entry.rawAdmissionType,
          order: entry.order,
          semesters: Array.from(entry.semesters.values()).sort((a, b) => a.name.localeCompare(b.name, 'ar')),
        }))
        .sort((a, b) => {
          if (a.order === b.order) {
            return a.name.localeCompare(b.name, 'ar');
          }
          return a.order - b.order;
        });
    },
    [metadata.departmentStages, metadata.stages]
  );

  const departmentStageOptions = useMemo(
    () => getDepartmentStageOptions(bulkData.selectedDepartments),
    [bulkData.selectedDepartments, getDepartmentStageOptions]
  );

  const resetAudiencePreview = useCallback(() => {
    previewSignatureRef.current = null;
    setAudiencePreview([]);
    setPreviewError(null);
  }, []);

  const buildFiltersPayload = useCallback(() => {
    const payload: Record<string, unknown> = {};

    switch (bulkData.audienceType) {
      case 'department': {
        payload.departments = bulkData.selectedDepartments;
        payload.departmentNames = metadata.departments
          .filter((dep) => bulkData.selectedDepartments.includes(dep.id))
          .map((dep) => dep.name);

        if (bulkData.selectedStage) {
          const stageOption = getDepartmentStageOptions(bulkData.selectedDepartments).find(
            (stage) => stage.id === bulkData.selectedStage
          );
          if (stageOption) {
            payload.stage = stageOption.id;
            payload.stageLabel = stageOption.name;
            payload.stageCode = stageOption.rawAdmissionType ?? null;

            if (bulkData.selectedSemester) {
              const semesterOption = stageOption.semesters.find((semester) => semester.id === bulkData.selectedSemester);
              if (semesterOption) {
                payload.semester = semesterOption.id;
                payload.semesterLabel = semesterOption.name;
                payload.semesterRaw = semesterOption.raw;
              }
            }
          }
        }
        break;
      }
      case 'stage': {
        payload.stage = bulkData.selectedStage || null;
        if (bulkData.selectedStage) {
          const stageOption = metadata.stages.find((stage) => stage.id === bulkData.selectedStage);
          if (stageOption) {
            payload.stageLabel = stageOption.name;
            payload.stageCode = stageOption.rawAdmissionType ?? null;
          }
        }
        break;
      }
      case 'semester': {
        payload.stage = bulkData.selectedStage || null;
        payload.semester = bulkData.selectedSemester || null;
        if (bulkData.selectedStage) {
          const stageOption = metadata.stages.find((stage) => stage.id === bulkData.selectedStage);
          if (stageOption) {
            payload.stageLabel = stageOption.name;
            payload.stageCode = stageOption.rawAdmissionType ?? null;
            if (bulkData.selectedSemester) {
              const semesterOption = stageOption.semesters.find(
                (semester) => semester.id === bulkData.selectedSemester
              );
              if (semesterOption) {
                payload.semesterLabel = semesterOption.name;
                payload.semesterRaw = semesterOption.raw;
              }
            }
          }
        }
        break;
      }
      case 'newStudents': {
        payload.registrationStatus = 'registration_pending';
        break;
      }
      default:
        break;
    }

    return payload;
  }, [
    bulkData.audienceType,
    bulkData.selectedDepartments,
    bulkData.selectedStage,
    bulkData.selectedSemester,
    metadata.departments,
    metadata.stages,
    getDepartmentStageOptions,
  ]);

  const fetchAudiencePreview = useCallback(
    async (force = false) => {
      if (!bulkData.audienceType) {
        setAudiencePreview([]);
        setPreviewError('حدد الجمهور المستهدف لعرض القائمة.');
        return false;
      }

      if (bulkData.audienceType === 'custom') {
        const sourceStudents =
          customSelectedStudents.length > 0
            ? customSelectedStudents
            : bulkData.customStudents.map((phone, index) => ({
                id: `custom-${index}`,
                name: null,
                phone,
              }));

        const normalizedRecipients: CampaignRecipient[] = sourceStudents.map((student, index) => ({
          id: student.id ?? `custom-${index}`,
          name: student.name ?? null,
          phone: student.phone?.trim() ?? '',
        }));

        setAudiencePreview(normalizedRecipients);

        const hasValidPhone = normalizedRecipients.some((recipient) => recipient.phone);
        if (!hasValidPhone) {
          setPreviewError('لم يتم العثور على أرقام صالحة في القائمة المخصصة.');
          return false;
        }

        setPreviewError(null);
        return true;
      }

      const filtersPayload = buildFiltersPayload();
      const signature = JSON.stringify({
        audienceType: bulkData.audienceType,
        filters: filtersPayload,
        custom: null,
      });

      if (!force && previewSignatureRef.current === signature) {
        return true;
      }

      setIsPreviewLoading(true);
      setPreviewError(null);

      try {
        const response = await fetch('/api/communications/preview', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            audienceType: bulkData.audienceType,
            filters: filtersPayload,
            customRecipients: [],
          }),
        });

        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || `تعذر جلب قائمة المستلمين (الحالة ${response.status})`);
        }

        const recipients: CampaignRecipient[] = Array.isArray(payload.data?.recipients)
          ? payload.data.recipients
          : [];

        previewSignatureRef.current = signature;
        setAudiencePreview(recipients);
        setPreviewError(recipients.length ? null : 'لم يتم العثور على مستلمين مطابقين للشروط.');
        return true;
      } catch (error) {
        console.error('خطأ أثناء جلب قائمة المستلمين المسبقة:', error);
        setAudiencePreview([]);
        setPreviewError(error instanceof Error ? error.message : 'تعذر جلب قائمة المستلمين.');
        return false;
      } finally {
        setIsPreviewLoading(false);
      }
    },
    [buildFiltersPayload, bulkData.audienceType, bulkData.customStudents, customSelectedStudents]
  );
  const [groupSendContext, setGroupSendContext] = useState<{
    campaignId: string;
    channelId: string;
    title: string;
    messageTemplate: string;
  } | null>(null);
  const [groupSendRecipients, setGroupSendRecipients] = useState<CampaignRecipient[]>([]);
  const [groupSendDeliveredPhones, setGroupSendDeliveredPhones] = useState<string[]>([]);
  const [groupSendSelection, setGroupSendSelection] = useState<Record<string, boolean>>({});
  const [isGroupSending, setIsGroupSending] = useState(false);
  const [groupSendProgress, setGroupSendProgress] = useState<{ opened: number; total: number }>({
    opened: 0,
    total: 0,
  });
  const [groupSendError, setGroupSendError] = useState<string | null>(null);
  const [groupSendSuccess, setGroupSendSuccess] = useState<string | null>(null);
  const [isBatchRecording, setIsBatchRecording] = useState(false);
  const [groupSendQueue, setGroupSendQueue] = useState<CampaignRecipient[]>([]);

  const selectedPrimaryChannel = bulkData.channels[0] ?? null;
  const isWhatsAppChannel = selectedPrimaryChannel === 'whatsapp';

  const [individualData, setIndividualData] = useState<IndividualMessageForm>({
    studentId: '',
    studentName: '',
    subject: '',
    message: '',
    messageType: 'notification',
    channels: ['systemNotification'],
    priority: 'medium',
    attachments: [],
    scheduledDate: '',
    scheduledTime: '',
    isScheduled: false
  });

  const [settingsData, setSettingsData] = useState<NotificationSettings>({
    emailNotifications: true,
    systemNotifications: true,
    pushNotifications: true,
    smsNotifications: false,
    notificationTypes: {
      academic: true,
      administrative: true,
      financial: false,
      events: true,
      warnings: true,
      reminders: true
    },
    quietHours: {
      enabled: false,
      startTime: '22:00',
      endTime: '08:00'
    },
    language: 'ar',
    autoSyncExternalSystems: true
  });

  useEffect(() => {
    const controller = new AbortController();

    async function loadMetadata() {
      setIsMetadataLoading(true);
      setMetadataError(null);
      try {
        const response = await fetch('/api/communications/overview', { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`فشل الطلب مع الحالة ${response.status}`);
        }

        const payload = await response.json();
        if (!payload?.success) {
          throw new Error(payload?.error || 'استجابة غير متوقعة من الخادم');
        }

        setMetadata({
          departments: payload.data?.departments ?? [],
          stages: payload.data?.stages ?? [],
          departmentStages: payload.data?.departmentStages ?? {},
          totals: payload.data?.totals ?? { totalStudents: 0 },
          newStudentsCount: payload.data?.newStudentsCount ?? 0,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        console.error('خطأ أثناء تحميل بيانات الاتصالات:', error);
        setMetadataError('تعذر تحميل بيانات الأقسام والمراحل. حاول مرة أخرى أو تواصل مع فريق الدعم.');
      } finally {
        if (!controller.signal.aborted) {
          setIsMetadataLoading(false);
        }
      }
    }

    loadMetadata();

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    setBulkData((prev) => {
      const validDepartments = prev.selectedDepartments.filter((id) =>
        metadata.departments.some((department) => department.id === id)
      );

      const stageOptions =
        prev.audienceType === 'department'
          ? getDepartmentStageOptions(validDepartments)
          : metadata.stages;

      const selectedStageExists = prev.selectedStage && stageOptions.some((stage) => stage.id === prev.selectedStage);

      const validStage = selectedStageExists ? prev.selectedStage : '';
      const validSemester =
        selectedStageExists &&
        prev.selectedSemester &&
        stageOptions
          .find((stage) => stage.id === prev.selectedStage)
          ?.semesters.some((semester) => semester.id === prev.selectedSemester)
          ? prev.selectedSemester
          : '';

      if (
        validDepartments.length === prev.selectedDepartments.length &&
        validStage === prev.selectedStage &&
        validSemester === prev.selectedSemester
      ) {
        return prev;
      }

      return {
        ...prev,
        selectedDepartments: validDepartments,
        selectedStage: validStage,
        selectedSemester: validSemester,
      };
    });
  }, [metadata.departments, metadata.stages, getDepartmentStageOptions]);

  useEffect(() => {
    if (showBulkForm) {
      setCampaignError(null);
    }
  }, [showBulkForm]);

  useEffect(() => {
    if (showBulkForm) {
      setBulkStep(1);
      setBulkData({
        title: '',
        message: '',
        audienceType: 'all',
        selectedDepartments: [],
        selectedStage: '',
        selectedSemester: '',
        customStudents: [],
        channels: [],
        priority: 'medium',
      });
      resetAudiencePreview();
      setCustomSearchQuery('');
      setCustomSearchResults([]);
      setCustomSelectedStudents([]);
    } else {
      customSearchAbortRef.current?.abort();
    }
  }, [resetAudiencePreview, showBulkForm]);

  useEffect(() => {
    if (bulkData.audienceType !== 'custom') {
      customSearchAbortRef.current?.abort();
      setIsCustomSearchLoading(false);
      setCustomSearchResults([]);
      return;
    }

    const query = customSearchQuery.trim();
    if (!query) {
      customSearchAbortRef.current?.abort();
      setIsCustomSearchLoading(false);
      setCustomSearchResults([]);
      return;
    }

    const controller = new AbortController();
    customSearchAbortRef.current = controller;
    setIsCustomSearchLoading(true);

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/communications/students?q=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) {
          throw new Error(payload?.error || `تعذر البحث عن الطلبة (الحالة ${response.status})`);
        }
        const selectedIds = new Set(customSelectedStudents.map((student) => student.id));
        const results: StudentQuickPick[] = Array.isArray(payload.data)
          ? payload.data.filter((student: StudentQuickPick) => !selectedIds.has(student.id))
          : [];
        setCustomSearchResults(results);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        console.error('خطأ أثناء البحث عن الطلبة:', error);
        setCustomSearchResults([]);
      } finally {
        if (!controller.signal.aborted) {
          setIsCustomSearchLoading(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [bulkData.audienceType, customSearchQuery, customSelectedStudents]);

  const fetchCampaigns = useCallback(async () => {
    setCampaignsLoading(true);
    setCampaignsError(null);
    try {
      const response = await fetch('/api/communications/campaigns');
      if (!response.ok) {
        throw new Error(`فشل جلب الحملات (الحالة ${response.status})`);
      }
      const payload = await response.json();
      if (!payload?.success) {
        throw new Error(payload?.error || 'تعذر جلب الحملات');
      }
      const campaignsData: CampaignSummary[] = payload.data ?? [];
      setCampaigns(campaignsData);
      setExpandedCampaignIds((prev) => {
        if (!campaignsData.length) {
          return [];
        }
        const previousSet = new Set(prev);
        const persisted = campaignsData.filter((campaign) => previousSet.has(campaign.id)).map((c) => c.id);
        if (persisted.length) {
          return persisted;
        }
        return campaignsData.slice(0, 3).map((campaign) => campaign.id);
      });
    } catch (error) {
      console.error('خطأ أثناء جلب حملات المراسلات:', error);
      setCampaignsError(error instanceof Error ? error.message : 'تعذر جلب الحملات');
    } finally {
      setCampaignsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const handleRefreshCampaigns = useCallback(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const audienceSummary = useMemo(() => {
    const totalStudents = metadata.totals?.totalStudents ?? 0;
    const loadingDescription = 'جارٍ تحميل البيانات من النظام...';
    const errorDescription =
      metadataError || 'تعذر العثور على بيانات مطابقة، تأكد من أن الأقسام والمراحل مسجلة في النظام.';

    switch (bulkData.audienceType) {
      case 'all':
        return {
          title: 'جميع الطلبة',
          description: isMetadataLoading
            ? loadingDescription
            : `سيتم شمول ${totalStudents.toLocaleString()} طالب مسجل في النظام الحالي.`,
          count: totalStudents
        };
      case 'department': {
        if (isMetadataLoading) {
          return {
            title: 'يتم تحميل الأقسام...',
            description: loadingDescription,
            count: 0
          };
        }

        if (!metadata.departments.length) {
          return {
            title: 'لا توجد بيانات أقسام',
            description: errorDescription,
            count: 0
          };
        }

        const selectedDepartments = metadata.departments.filter((dep) => bulkData.selectedDepartments.includes(dep.id));
        const departmentsCount = selectedDepartments.reduce((acc, dep) => acc + (dep.count || 0), 0);
        const stageOption = metadata.stages.find((stage) => stage.id === bulkData.selectedStage);
        const semesterOption = stageOption?.semesters.find((sem) => sem.id === bulkData.selectedSemester);

        const departmentsDescription = selectedDepartments
          .map((dep) => `${dep.name} (${dep.count.toLocaleString()} طالب)`)
          .join('، ');

        const summaryParts = [] as string[];
        if (departmentsDescription) {
          summaryParts.push(departmentsDescription);
        }
        if (stageOption) {
          summaryParts.push(`المرحلة: ${stageOption.name}`);
        }
        if (semesterOption) {
          summaryParts.push(`الفصل: ${semesterOption.name}`);
        }

        const countEstimate = (() => {
          if (semesterOption?.count != null) {
            return Math.min(semesterOption.count, departmentsCount);
          }
          if (stageOption?.total != null) {
            return Math.min(stageOption.total, departmentsCount);
          }
          return departmentsCount;
        })();

        return {
          title: selectedDepartments.length ? `الأقسام المختارة (${selectedDepartments.length})` : 'اختر قسماً واحداً على الأقل',
          description: selectedDepartments.length
            ? summaryParts.filter(Boolean).join(' — ')
            : 'اختر قسمك ثم حدّد المرحلة الدراسية والفصل الدراسي المرتبطين.',
          count: countEstimate,
        };
      }
      case 'stage': {
        if (isMetadataLoading) {
          return {
            title: 'يتم تحميل المراحل...',
            description: loadingDescription,
            count: 0
          };
        }

        const stage = metadata.stages.find((item) => item.id === bulkData.selectedStage);
        return {
          title: stage ? stage.name : metadata.stages.length ? 'اختر المرحلة الدراسية' : 'لا توجد مراحل مسجلة',
          description: stage
            ? `سيتم استهداف ${stage.total.toLocaleString()} طالب من ${stage.name}.`
            : metadata.stages.length
              ? 'اختر المرحلة الدراسية لاستكمال الإرسال.'
              : errorDescription,
          count: stage?.total ?? 0
        };
      }
      case 'semester': {
        if (isMetadataLoading) {
          return {
            title: 'يتم تحميل الفصول...',
            description: loadingDescription,
            count: 0
          };
        }

        const stage = metadata.stages.find((item) => item.id === bulkData.selectedStage);
        const semester = stage?.semesters.find((item) => item.id === bulkData.selectedSemester);
        return {
          title: semester ? semester.name : 'اختر الفصل الدراسي',
          description: stage
            ? `المرحلة: ${stage.name}. ${semester ? `الفصل المختار: ${semester.name}.` : 'اختر الفصل الدراسي المرتبط بها.'}`
            : metadata.stages.length
              ? 'حدّد المرحلة ثم اختر الفصل الدراسي المرتبط بها.'
              : errorDescription,
          count: semester?.count ?? 0
        };
      }
      case 'newStudents':
        return {
          title: 'الطلبة الجدد قيد التسجيل',
          description: isMetadataLoading
            ? loadingDescription
            : metadata.newStudentsCount
              ? `هناك ${metadata.newStudentsCount.toLocaleString()} طالب بحالة تسجيل معلقة يحتاجون للمتابعة.`
              : 'لا يوجد حالياً طلبة جدد بحالة قيد التسجيل.',
          count: metadata.newStudentsCount
        };
      case 'custom': {
        const count = customSelectedStudents.length || bulkData.customStudents.length;
        return {
          title: `قائمة مخصصة (${count})`,
          description: count
            ? `تم اختيار ${count} طالب لاستقبال الرسالة بشكل مباشر.`
            : 'ابحث عن الطلبة المطلوبين وأضفهم إلى القائمة المخصصة.',
          count
        };
      }
      default:
        return { title: 'لم يتم تحديد جمهور', description: 'اختر نوع الجمهور لعرض تفاصيله.', count: 0 };
    }
  }, [bulkData, metadata, isMetadataLoading, metadataError, customSelectedStudents]);

  const handleBulkSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCampaignError(null);
    setCampaignSuccess(null);

    if (!bulkData.channels.length) {
      setCampaignError('يرجى اختيار قناة أو أكثر للإرسال.');
      return;
    }

    const validationError = validateAudienceSelection();
    if (validationError) {
      setCampaignError(validationError);
      return;
    }

    let customRecipientIds = bulkData.customStudents;
    if (bulkData.audienceType === 'custom') {
      const derivedPhones =
        customSelectedStudents.length > 0
          ? customSelectedStudents
              .map((student) => student.phone?.trim())
              .filter((phone): phone is string => !!phone && phone.length > 0)
          : bulkData.customStudents.filter(
              (phone): phone is string => typeof phone === 'string' && phone.trim().length > 0
            );
      if (!derivedPhones.length) {
        setCampaignError('أضف رقم هاتف واحداً على الأقل إلى القائمة المخصصة قبل الإطلاق.');
        return;
      }
      customRecipientIds = Array.from(new Set(derivedPhones));
      setBulkData((prev) => ({
        ...prev,
        customStudents: customRecipientIds,
      }));
    }

    const filtersPayload = buildFiltersPayload();

    const payload = {
      title: bulkData.title,
      message: bulkData.message,
      priority: bulkData.priority,
      audienceType: bulkData.audienceType,
      filters: filtersPayload,
      customRecipients: bulkData.audienceType === 'custom' ? customRecipientIds : [],
      channels: bulkData.channels.map((channel) => ({
        channelType: channel,
      })),
      totalRecipientsEstimate:
        typeof audienceSummary.count === 'number' ? audienceSummary.count : null,
    };

    setIsSavingCampaign(true);
    try {
      const response = await fetch('/api/communications/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok || !result?.success) {
        throw new Error(result?.error || 'تعذر إنشاء الحملة');
      }

      setCampaignSuccess('تم حفظ الحملة بنجاح وسيتم معالجتها وفق الإعدادات المحددة.');
    setShowBulkForm(false);
    setBulkData({
      title: '',
      message: '',
        audienceType: 'all',
        selectedDepartments: [],
        selectedStage: '',
        selectedSemester: '',
      customStudents: [],
        channels: [],
        priority: 'medium'
      });
    } catch (error) {
      console.error('خطأ في إنشاء حملة المراسلات:', error);
      setCampaignError(
        error instanceof Error ? error.message : 'حدث خطأ غير متوقع أثناء إنشاء الحملة.'
      );
    } finally {
      setIsSavingCampaign(false);
    }
  };

  const handleToggleCampaignExpansion = useCallback((campaignId: string) => {
    setExpandedCampaignIds((prev) => {
      if (prev.includes(campaignId)) {
        return prev.filter((id) => id !== campaignId);
      }
      return [...prev, campaignId];
    });
  }, []);

  const handleExpandAllCampaigns = useCallback(() => {
    setExpandedCampaignIds(campaigns.map((campaign) => campaign.id));
  }, [campaigns]);

  const handleCollapseAllCampaigns = useCallback(() => {
    setExpandedCampaignIds([]);
  }, []);

  const normalizePhone = (value: string) => value.replace(/\D/g, '');

  const openWhatsAppChat = (
    phone: string,
    message: string,
    options?: {
      muteError?: boolean;
    }
  ) => {
    const phoneDigits = normalizePhone(phone);
    if (!phoneDigits) {
      if (!options?.muteError) {
        setCampaignError('لا يمكن فتح واتساب لأن الرقم غير صالح.');
      }
      return false;
    }

    const desktopUrl = `whatsapp://send?phone=${phoneDigits}&text=${encodeURIComponent(message)}`;
    const webUrl = `https://web.whatsapp.com/send?phone=${phoneDigits}&text=${encodeURIComponent(message)}`;

    const openDesktop = () => {
      try {
        if (typeof window === 'undefined') {
          return false;
        }

        const popup = window.open(desktopUrl, '_blank');
        if (popup) {
          popup.opener = null;
          return true;
        }

        window.location.href = desktopUrl;
        return true;
      } catch (error) {
        console.error('تعذر فتح تطبيق واتساب:', error);
        return false;
      }
    };

    const openWeb = () => {
      try {
        window.open(webUrl, '_blank', 'noopener,noreferrer');
        return true;
      } catch (error) {
        console.error('تعذر فتح واتساب ويب:', error);
        return false;
      }
    };

    if (openDesktop()) {
      return true;
    }

    if (openWeb()) {
      return true;
    }

    if (!options?.muteError) {
      setCampaignError('تعذر فتح واتساب. تحقق من تثبيت التطبيق أو إعدادات المتصفح ومنع النوافذ المنبثقة.');
    }

    return false;
  };

  const getRecipientKey = useCallback((campaignId: string, recipient: CampaignRecipient) => {
    const phoneDigits = normalizePhone(recipient.phone);
    return `${campaignId}-${phoneDigits || recipient.phone}-${recipient.id || 'unknown'}`;
  }, []);

  const personalizeMessage = (template: string, recipient: CampaignRecipient) => {
    const safeName = (recipient.name && recipient.name.trim()) || 'الطالب العزيز';
    const safeId = (recipient.id && recipient.id.trim()) || '';

    let message = template
      .replace(/\{\{اسم_الطالب\}\}/g, safeName)
      .replace(/\{\{الرقم_الجامعي\}\}/g, safeId);

    if (!message.trim()) {
      message = template.trim() ? template : `مرحباً ${safeName}`;
    }

    return message;
  };

  const submitManualDelivery = async (
    campaignId: string,
    channelId: string,
    recipient: string,
    message: string
  ) => {
    const phoneDigits = normalizePhone(recipient);
    if (!phoneDigits) {
      throw new Error('الرقم غير صالح، لا يمكن تسجيل الإرسال.');
    }

    const response = await fetch('/api/communications/campaigns/manual-delivery', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        campaignId,
        channelId,
        recipient: phoneDigits,
        message,
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.error || `فشل تسجيل الإرسال اليدوي (الحالة ${response.status})`);
    }

    return phoneDigits;
  };

  const handleManualDelivery = async (
    campaignId: string,
    channelId: string,
    recipient: string,
    message: string
  ) => {
    const phoneDigits = normalizePhone(recipient);
    if (!phoneDigits) {
      setCampaignError('الرقم غير صالح، لا يمكن تسجيل الإرسال.');
      return;
    }
    const key = `${campaignId}-${phoneDigits}`;
    setManualSendingKey(key);
    setCampaignError(null);
    setCampaignSuccess(null);
    try {
      const registeredPhone = await submitManualDelivery(campaignId, channelId, recipient, message);
      setCampaignSuccess(`تم تسجيل الإرسال اليدوي للرقم ${registeredPhone}.`);
      await fetchCampaigns();
    } catch (error) {
      console.error('خطأ أثناء تسجيل الإرسال اليدوي:', error);
      setCampaignError(error instanceof Error ? error.message : 'تعذر تسجيل الإرسال اليدوي');
    } finally {
      setManualSendingKey(null);
    }
  };

  const deliveredPhonesSet = useMemo(
    () => new Set(groupSendDeliveredPhones),
    [groupSendDeliveredPhones]
  );

  const recalculateGroupSelection = (selection: Record<string, boolean>) => {
    if (!groupSendContext) {
      setGroupSendProgress({ opened: 0, total: 0 });
      return;
    }

    const totalSelected = groupSendRecipients.reduce((acc, recipient) => {
      const key = getRecipientKey(groupSendContext.campaignId, recipient);
      return selection[key] ? acc + 1 : acc;
    }, 0);

    setGroupSendProgress((prev) => ({
      opened: Math.min(prev.opened, totalSelected),
      total: totalSelected,
    }));
  };

  const openGroupSendModal = (
    campaign: CampaignSummary,
    channel: CampaignChannelSummary,
    deliveredRecipients: Set<string>
  ) => {
    const deliveredSet = new Set(Array.from(deliveredRecipients));
    const initialSelection: Record<string, boolean> = {};

    campaign.recipients.forEach((recipient) => {
      const key = getRecipientKey(campaign.id, recipient);
      const phoneDigits = normalizePhone(recipient.phone);
      const shouldSelect = !!phoneDigits && !deliveredSet.has(phoneDigits);
      initialSelection[key] = shouldSelect;
    });

    setGroupSendContext({
      campaignId: campaign.id,
      channelId: channel.id,
      title: campaign.title,
      messageTemplate: campaign.message,
    });
    setGroupSendRecipients(campaign.recipients);
    setGroupSendDeliveredPhones(Array.from(deliveredSet));
    setGroupSendSelection(initialSelection);
    setGroupSendError(null);
    setGroupSendSuccess(null);
    setIsGroupSending(false);
    setIsBatchRecording(false);
    setGroupSendProgress({ opened: 0, total: 0 });
    recalculateGroupSelection(initialSelection);
  };

  const closeGroupSendModal = () => {
    setGroupSendContext(null);
    setGroupSendRecipients([]);
    setGroupSendDeliveredPhones([]);
    setGroupSendSelection({});
    setGroupSendError(null);
    setGroupSendSuccess(null);
    setIsGroupSending(false);
    setIsBatchRecording(false);
    setGroupSendProgress({ opened: 0, total: 0 });
    setGroupSendQueue([]);
  };

  const toggleGroupRecipientSelection = (key: string) => {
    setGroupSendSelection((prev) => {
      const next = {
        ...prev,
        [key]: !prev[key],
      };
      recalculateGroupSelection(next);
      return next;
    });
  };

  const setAllGroupRecipients = (selectAll: boolean) => {
    if (!groupSendContext) {
      return;
    }
    const updated: Record<string, boolean> = {};
    groupSendRecipients.forEach((recipient) => {
      const key = getRecipientKey(groupSendContext.campaignId, recipient);
      const phoneDigits = normalizePhone(recipient.phone);
      updated[key] = selectAll && !!phoneDigits && !deliveredPhonesSet.has(phoneDigits);
    });
    setGroupSendSelection(updated);
    recalculateGroupSelection(updated);
  };

  const startGroupSend = () => {
    if (!groupSendContext) {
      return;
    }
    const { campaignId } = groupSendContext;
    const selectedRecipients = groupSendRecipients.filter((recipient) => {
      const key = getRecipientKey(campaignId, recipient);
      return groupSendSelection[key];
    });

    if (!selectedRecipients.length) {
      setGroupSendError('اختر مستلمًا واحدًا على الأقل لبدء الإرسال الجماعي.');
      return;
    }

    const queue = selectedRecipients.filter((recipient) => {
      const phoneDigits = normalizePhone(recipient.phone);
      return !!phoneDigits;
    });

    if (!queue.length) {
      setGroupSendError('لا يوجد أرقام صالحة لفتح محادثات واتساب.');
      return;
    }

    setGroupSendQueue(queue);
    setGroupSendProgress({ opened: 0, total: queue.length });
    setGroupSendError(null);
    setGroupSendSuccess(null);

    openNextGroupChat(queue);
  };

  const openNextGroupChat = (queueOverride?: CampaignRecipient[]) => {
    if (!groupSendContext) {
      return;
    }

    const queueSource = queueOverride ?? groupSendQueue;

    if (!queueSource.length) {
      setGroupSendError(null);
      setGroupSendSuccess('تم فتح جميع المحادثات المحددة. بعد الإرسال اليدوي قم بتسجيل الحالة.');
      return;
    }

    setIsGroupSending(true);

    const remainingRecipients: CampaignRecipient[] = [];
    const invalidPhones: string[] = [];
    let opened = false;

    for (let index = 0; index < queueSource.length; index += 1) {
      const recipient = queueSource[index];
      const phoneDigits = normalizePhone(recipient.phone);

      if (!phoneDigits) {
        invalidPhones.push(recipient.phone);
        continue;
      }

      if (!opened) {
        const success = openWhatsAppChat(
          recipient.phone,
          personalizeMessage(groupSendContext.messageTemplate, recipient),
          { muteError: true }
        );

        if (success) {
          opened = true;
          continue;
        }

        invalidPhones.push(recipient.phone);
        continue;
      }

      remainingRecipients.push(recipient);
    }

    setGroupSendQueue(remainingRecipients);
    setGroupSendProgress((prev) => ({
      opened: prev.opened + (opened ? 1 : 0),
      total: prev.total || queueSource.length,
    }));

    setIsGroupSending(false);

    if (invalidPhones.length) {
      setGroupSendError(`تم تجاهل ${invalidPhones.length} رقم غير صالح: ${invalidPhones.join('، ')}`);
    } else {
      setGroupSendError(null);
    }

    if (opened) {
      if (remainingRecipients.length) {
        setGroupSendSuccess(`تم فتح محادثة جديدة. متبقٍ ${remainingRecipients.length} مستلم.`);
      } else {
        setGroupSendSuccess('تم فتح آخر محادثة. بعد الإرسال اليدوي قم بتسجيل الحالة.');
      }
    } else if (!remainingRecipients.length) {
      setGroupSendSuccess('لم يتم العثور على أرقام صالحة لفتح المحادثة.');
    }
  };

  const handleBatchDeliveryRegistration = async () => {
    if (!groupSendContext) {
      return;
    }

    const { campaignId, channelId, messageTemplate } = groupSendContext;

    const selectedRecipients = groupSendRecipients.filter((recipient) => {
      const key = getRecipientKey(campaignId, recipient);
      return groupSendSelection[key];
    });

    if (!selectedRecipients.length) {
      setGroupSendError('اختر المستلمين الذين تريد تسجيل إرسالهم.');
      return;
    }

    const pendingRecipients = selectedRecipients.filter((recipient) => {
      const phoneDigits = normalizePhone(recipient.phone);
      return phoneDigits && !deliveredPhonesSet.has(phoneDigits);
    });

    if (!pendingRecipients.length) {
      setGroupSendError('جميع المستلمين المحددين مسجلون مسبقًا.');
      return;
    }

    setIsBatchRecording(true);
    setGroupSendError(null);
    setGroupSendSuccess(null);

    try {
      const results = await Promise.all(
        pendingRecipients.map(async (recipient) => {
          try {
            const phoneDigits = await submitManualDelivery(
              campaignId,
              channelId,
              recipient.phone,
              personalizeMessage(messageTemplate, recipient)
            );
            return { success: true, phoneDigits };
          } catch (error) {
            console.error('خطأ أثناء التسجيل الجماعي:', error);
            return {
              success: false,
              phone: recipient.phone,
              message: error instanceof Error ? error.message : 'تعذر تسجيل الإرسال اليدوي',
            };
          }
        })
      );

      const successfulResults = results.filter(
        (result): result is { success: true; phoneDigits: string } => result.success
      );
      const failedResults = results.filter(
        (result): result is { success: false; phone: string; message: string } => !result.success
      );

      if (successfulResults.length) {
        setGroupSendSuccess(`تم تسجيل الإرسال لـ ${successfulResults.length} مستلم.`);
        setGroupSendDeliveredPhones((prev) => {
          const updated = new Set(prev);
          successfulResults.forEach((item) => updated.add(item.phoneDigits));
          return Array.from(updated);
        });
        setGroupSendSelection((prev) => {
          if (!groupSendContext) {
            return prev;
          }
          const next = { ...prev };
          const successSet = new Set(successfulResults.map((item) => item.phoneDigits));
          groupSendRecipients.forEach((recipient) => {
            const phoneDigits = normalizePhone(recipient.phone);
            if (phoneDigits && successSet.has(phoneDigits)) {
              const key = getRecipientKey(groupSendContext.campaignId, recipient);
              next[key] = false;
            }
          });
          recalculateGroupSelection(next);
          return next;
        });
        await fetchCampaigns();
      }

      if (failedResults.length) {
        const failureMessage = failedResults
          .map((item) => `${item.phone}${item.message ? ` (${item.message})` : ''}`)
          .join('، ');
        setGroupSendError(`تعذر تسجيل ${failedResults.length} مستلم: ${failureMessage}`);
      }
    } catch (error) {
      console.error('خطأ غير متوقع أثناء التسجيل الجماعي:', error);
      setGroupSendError('تعذر إكمال التسجيل الجماعي. حاول مرة أخرى.');
    } finally {
      setIsBatchRecording(false);
    }
  };

  const validateAudienceSelection = useCallback((): string | null => {
    switch (bulkData.audienceType) {
      case 'department':
        if (!bulkData.selectedDepartments.length) {
          return 'اختر قسماً واحداً على الأقل ضمن الجمهور المستهدف.';
        }
        if (!bulkData.selectedStage) {
          return 'اختر المرحلة الدراسية المرتبطة بالأقسام المختارة.';
        }
        if (!bulkData.selectedSemester) {
          return 'اختر الفصل الدراسي المرتبط بالمرحلة المختارة.';
        }
        return null;
      case 'stage':
        return bulkData.selectedStage ? null : 'اختر المرحلة الدراسية المستهدفة.';
      case 'semester':
        if (!bulkData.selectedStage) {
          return 'اختر المرحلة الدراسية أولاً.';
        }
        if (!bulkData.selectedSemester) {
          return 'اختر الفصل الدراسي المرتبط بالمرحلة.';
        }
        return null;
      case 'custom': {
        const count = customSelectedStudents.length || bulkData.customStudents.length;
        return count ? null : 'أضف طالباً واحداً على الأقل إلى القائمة المخصصة.';
      }
      default:
        return null;
    }
  }, [
    bulkData.audienceType,
    bulkData.customStudents.length,
    bulkData.selectedDepartments.length,
    bulkData.selectedSemester,
    bulkData.selectedStage,
    customSelectedStudents.length,
  ]);

  const handleBulkStepNext = useCallback(async () => {
    setCampaignError(null);

    if (bulkStep === 1) {
      if (!selectedPrimaryChannel) {
        setCampaignError('اختر قناة مراسلة واحدة على الأقل للمتابعة.');
        return;
      }
      setBulkStep(2);
      return;
    }

    if (bulkStep === 2) {
      const validationError = validateAudienceSelection();
      if (validationError) {
        setCampaignError(validationError);
        return;
      }

      if (bulkData.audienceType === 'custom') {
        const phones =
          customSelectedStudents.length > 0
            ? customSelectedStudents
                .map((student) => student.phone?.trim())
                .filter((phone): phone is string => !!phone && phone.length > 0)
            : bulkData.customStudents;
        setBulkData((prev) => ({
          ...prev,
          customStudents: Array.from(new Set(phones)),
        }));
      }

      const success = await fetchAudiencePreview(true);
      if (success) {
        setBulkStep(3);
      } else {
        setCampaignError((prev) => prev || 'تعذر جلب قائمة المستلمين. حاول مرة أخرى.');
      }
    }
  }, [
    bulkData.audienceType,
    bulkData.customStudents,
    bulkStep,
    customSelectedStudents,
    fetchAudiencePreview,
    selectedPrimaryChannel,
    validateAudienceSelection,
  ]);

  const handleBulkStepBack = useCallback(() => {
    setCampaignError(null);
    setBulkStep((prev) => {
      if (prev === 1) {
        return prev;
      }
      return (prev - 1) as 1 | 2 | 3;
    });
  }, []);

  const handleAddCustomStudent = useCallback((student: StudentQuickPick) => {
    setCustomSelectedStudents((prev) => {
      if (prev.some((item) => item.id === student.id)) {
        return prev;
      }
      const next = [...prev, student];
      setBulkData((prevBulk) => ({
        ...prevBulk,
        customStudents: student.phone && student.phone.trim()
          ? Array.from(
              new Set([
                ...prevBulk.customStudents,
                student.phone.trim(),
              ])
            )
          : prevBulk.customStudents,
      }));
      setCustomSearchResults((prevResults) => prevResults.filter((item) => item.id !== student.id));
      setCustomSearchQuery('');
      return next;
    });
  }, []);

  const handleRemoveCustomStudent = useCallback((studentId: string) => {
    setCustomSelectedStudents((prev) => {
      const next = prev.filter((item) => item.id !== studentId);
      setBulkData((prevBulk) => ({
        ...prevBulk,
        customStudents: next
          .map((item) => item.phone?.trim())
          .filter((phone): phone is string => !!phone && phone.length > 0),
      }));
      return next;
    });
  }, []);

  const handleIndividualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!individualData.channels.length) {
      alert('اختر على الأقل قناة واحدة لإرسال الرسالة.');
      return;
    }
    console.log('💬 مراسلة فردية جديدة:', individualData);
    alert('تم إرسال الرسالة الفردية بنجاح!');
    setShowIndividualForm(false);
    setIndividualData({
      studentId: '',
      studentName: '',
      subject: '',
      message: '',
      messageType: 'notification',
      channels: ['systemNotification'],
      priority: 'medium',
      attachments: [],
      scheduledDate: '',
      scheduledTime: '',
      isScheduled: false
    });
  };

  const handleSettingsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('⚙️ إعدادات الإشعارات المحدثة:', settingsData);
    alert('تم حفظ إعدادات الإشعارات والتكاملات بنجاح!');
    setShowSettingsForm(false);
  };

  const handleBulkInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    if (name === 'audienceType') {
      setBulkData((prev) => ({
        ...prev,
        audienceType: value as BulkNotificationForm['audienceType'],
        selectedDepartments: [],
        selectedStage: '',
        selectedSemester: '',
        customStudents: []
      }));
      return;
    }

    if (name === 'selectedStage') {
      setBulkData((prev) => ({
        ...prev,
        selectedStage: value,
        selectedSemester: '',
      }));
      return;
    }

    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setBulkData((prev) => ({
        ...prev,
        [name]: checked
      }));
    } else {
      setBulkData((prev) => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleIndividualInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setIndividualData((prev) => ({
        ...prev,
        [name]: checked
      }));
    } else {
      setIndividualData((prev) => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const selectedGroupRecipients = useMemo(() => {
    if (!groupSendContext) {
      return [];
    }
    return groupSendRecipients.filter((recipient) => {
      const key = getRecipientKey(groupSendContext.campaignId, recipient);
      return groupSendSelection[key];
    });
  }, [getRecipientKey, groupSendContext, groupSendRecipients, groupSendSelection]);

  const pendingSelectedRecipientsCount = useMemo(() => {
    if (!groupSendContext) {
      return 0;
    }
    return selectedGroupRecipients.filter((recipient) => {
      const phoneDigits = normalizePhone(recipient.phone);
      return phoneDigits && !deliveredPhonesSet.has(phoneDigits);
    }).length;
  }, [deliveredPhonesSet, groupSendContext, selectedGroupRecipients]);

  const remainingQueueCount = groupSendQueue.length;

  const handleSettingsInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      if (name.startsWith('notificationTypes.')) {
        const field = name.split('.')[1];
        setSettingsData((prev) => ({
          ...prev,
          notificationTypes: {
            ...prev.notificationTypes,
            [field]: checked
          }
        }));
      } else if (name.startsWith('quietHours.')) {
        const field = name.split('.')[1];
        setSettingsData((prev) => ({
          ...prev,
          quietHours: {
            ...prev.quietHours,
            [field]: checked
          }
        }));
      } else {
        setSettingsData((prev) => ({
          ...prev,
          [name]: checked
        }));
      }
    } else {
      setSettingsData((prev) => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const toggleBulkChannel = (channel: Channel) => {
    setBulkData((prev) => ({
      ...prev,
      channels: prev.channels.includes(channel) ? [] : [channel]
    }));
  };

  const toggleBulkDepartment = (departmentId: string) => {
    setBulkData((prev) => ({
      ...prev,
      selectedDepartments: toggleInArray(prev.selectedDepartments, departmentId)
    }));
  };

  const toggleIndividualChannel = (channel: Channel) => {
    setIndividualData((prev) => ({
      ...prev,
      channels: toggleInArray(prev.channels, channel)
    }));
  };

  const renderChannelBadge = (channel: Channel) => (
    <span
      key={channel}
      className={`inline-flex items-center px-3 py-1 text-xs font-medium rounded-full ${CHANNEL_OPTIONS[channel].color}`}
    >
      {CHANNEL_OPTIONS[channel].label}
    </span>
  );

  const formatDateTime = (value?: string | null) => {
    if (!value) {
      return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }
    return date.toLocaleString('ar-IQ', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  };

  const getCampaignStatusColor = (status: string) => {
    switch (status) {
      case 'sent':
        return 'text-green-600 bg-green-100';
      case 'processing':
        return 'text-blue-600 bg-blue-100';
      case 'failed':
        return 'text-red-600 bg-red-100';
      case 'scheduled':
        return 'text-indigo-600 bg-indigo-100';
      case 'draft':
        return 'text-gray-600 bg-gray-100';
      case 'cancelled':
        return 'text-gray-500 bg-gray-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'text-red-600 bg-red-100';
      case 'high':
        return 'text-orange-600 bg-orange-100';
      case 'medium':
        return 'text-yellow-600 bg-yellow-100';
      case 'low':
        return 'text-green-600 bg-green-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'sent':
        return 'text-green-600 bg-green-100';
      case 'pending':
        return 'text-yellow-600 bg-yellow-100';
      case 'processing':
        return 'text-indigo-600 bg-indigo-100';
      case 'failed':
        return 'text-red-600 bg-red-100';
      case 'scheduled':
        return 'text-blue-600 bg-blue-100';
      case 'cancelled':
        return 'text-gray-500 bg-gray-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">نظام المراسلات والإشعارات</h1>
          <p className="text-gray-600">تنظيم التواصل مع جميع مستخدمي النظام من طلبة وأقسام وشعب وأساتذة عبر القنوات المختلفة</p>
        </div>

        <div className="bg-white rounded-lg shadow-lg mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex flex-wrap space-x-8 space-x-reverse px-6">
              <button
                onClick={() => setActiveTab('bulk')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'bulk'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                مراسلة الطلبة (إشعارات جماعية)
              </button>
              <button
                onClick={() => setActiveTab('individual')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'individual'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                مراسلة فردية
              </button>
              <button
                onClick={() => setActiveTab('orgUnits')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'orgUnits'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                مراسلة الوحدات والأقسام
              </button>
              <button
                onClick={() => setActiveTab('faculty')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'faculty'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                مراسلة الأساتذة
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'settings'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                إعدادات التنبيهات
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'history'
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                سجل المراسلات
              </button>
            </nav>
          </div>
        </div>

        {activeTab === 'bulk' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">إطلاق حملات المراسلة الجماعية</h2>
                <p className="text-sm text-gray-500">
                  اختر القنوات المناسبة وحدد الجمهور المستهدف بدقة، ثم أرسل أو جدول الحملة في الوقت الذي يناسبك.
                </p>
              </div>
              <button
                onClick={() => setShowBulkForm(!showBulkForm)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
              >
                {showBulkForm ? 'إلغاء إنشاء الحملة' : 'إنشاء حملة مراسلات'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4">
                <p className="text-sm text-indigo-600 font-semibold">معدل الوصول الكلي</p>
                <p className="mt-2 text-2xl font-bold text-indigo-800">
                  {isMetadataLoading ? '—' : `${metadata.totals.totalStudents.toLocaleString()} طالب`}
                </p>
                <p className="text-xs text-indigo-500 mt-1">
                  إجمالي الطلبة المسجلين القابلين للاستهداف حالياً
                </p>
              </div>
              <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-4">
                <p className="text-sm text-emerald-600 font-semibold">الطلبة الجدد قيد التسجيل</p>
                <p className="mt-2 text-2xl font-bold text-emerald-800">
                  {isMetadataLoading ? '—' : `${metadata.newStudentsCount.toLocaleString()} طالب`}
                </p>
                <p className="text-xs text-emerald-500 mt-1">
                  يحتاجون إلى متابعة استكمال إجراءات التسجيل
                </p>
              </div>
              <div className="bg-purple-50 border border-purple-100 rounded-lg p-4">
                <p className="text-sm text-purple-600 font-semibold">قنوات مفعّلة</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {Object.keys(CHANNEL_OPTIONS).map((channel) => renderChannelBadge(channel as Channel))}
                </div>
                <p className="text-xs text-purple-500 mt-1">يمكن إدارة القنوات من إعدادات التنبيهات</p>
              </div>
            </div>

            {campaignSuccess && (
              <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                {campaignSuccess}
              </div>
            )}

            {campaignError && showBulkForm && (
              <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {campaignError}
              </div>
            )}

            {metadataError && (
              <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {metadataError}
              </div>
            )}

            {isMetadataLoading && !metadataError && (
              <div className="mb-6 rounded-lg border border-indigo-200 border-dashed bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
                يتم تحميل بيانات الأقسام والمراحل والفصول، يرجى الانتظار لحظات قليلة...
              </div>
            )}

            {showBulkForm ? (
              <div className="space-y-8">
                <div className="flex flex-col gap-3 md:flex-row md:items-stretch md:gap-4">
                  {BULK_CREATION_STEPS.map((step) => {
                    const status =
                      step.id < bulkStep ? 'completed' : step.id === bulkStep ? 'current' : 'upcoming';
                    const containerClasses =
                      status === 'completed'
                        ? 'border-green-200 bg-green-50'
                        : status === 'current'
                        ? 'border-indigo-300 bg-indigo-50'
                        : 'border-gray-200 bg-white';
                    const badgeClasses =
                      status === 'completed'
                        ? 'bg-green-500 text-white'
                        : status === 'current'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-gray-300 text-gray-700';
                    return (
                      <div
                        key={step.id}
                        className={`flex-1 rounded-lg border px-4 py-4 shadow-sm transition ${containerClasses}`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${badgeClasses}`}
                          >
                            {status === 'completed' ? '✓' : `0${step.id}`}
                          </span>
                          <span
                            className={`text-xs font-medium ${
                              status === 'completed'
                                ? 'text-green-600'
                                : status === 'current'
                                ? 'text-indigo-600'
                                : 'text-gray-400'
                            }`}
                          >
                            {status === 'completed'
                              ? 'اكتملت'
                              : status === 'current'
                              ? 'الخطوة الحالية'
                              : 'قيد الانتظار'}
                          </span>
                        </div>
                        <h3
                          className={`mt-3 text-sm font-semibold ${
                            status === 'completed'
                              ? 'text-green-700'
                              : status === 'current'
                              ? 'text-indigo-700'
                              : 'text-gray-600'
                          }`}
                        >
                          {step.title}
                        </h3>
                        <p className="mt-1 text-xs leading-5 text-gray-500">{step.description}</p>
                      </div>
                    );
                  })}
                </div>

                {bulkStep === 1 && (
                  <section className="space-y-6">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">١. قناة المراسلة</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        اختر وسيلة الإرسال الأساسية للحملة. يمكنك تعديل الاختيار لاحقاً قبل الإطلاق.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {PRIMARY_CHANNEL_CANDIDATES.map((channel) => {
                        const option = CHANNEL_OPTIONS[channel];
                        const isSelected = selectedPrimaryChannel === channel;
                        return (
                          <button
                            key={channel}
                            type="button"
                            onClick={() => toggleBulkChannel(channel)}
                            className={`rounded-xl border px-4 py-4 text-right transition-all ${
                              isSelected
                                ? 'border-indigo-500 bg-indigo-50 shadow-sm ring-2 ring-indigo-100'
                                : 'border-gray-200 hover:border-indigo-200 hover:shadow-sm'
                            }`}
                          >
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-semibold text-gray-900">{option.label}</span>
                                <span
                                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                                    isSelected ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'
                                  }`}
                                >
                                  {isSelected ? '✓' : '١'}
                                </span>
                              </div>
                              <p className="text-xs leading-5 text-gray-500">{option.description}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {selectedPrimaryChannel ? (
                      <div
                        className={`rounded-lg border px-4 py-3 text-sm ${
                          isWhatsAppChannel
                            ? 'border-green-200 bg-green-50 text-green-700'
                            : selectedPrimaryChannel === 'sms'
                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : 'border-indigo-200 bg-indigo-50 text-indigo-700'
                        }`}
                      >
                        {selectedPrimaryChannel === 'whatsapp'
                          ? 'سيعرض النظام أزرار واتساب لكل طالب لإرسال الرسائل بسرعة مع تتبع شبه يدوي.'
                          : selectedPrimaryChannel === 'sms'
                          ? 'تأكد من ضبط بوابة SMS قبل إطلاق الحملة لضمان وصول الرسائل النصية.'
                          : selectedPrimaryChannel === 'email'
                          ? 'سيتم إرسال رسالة بريد إلكتروني رسمية إلى المستلمين بعد إطلاق الحملة.'
                          : 'سيظهر الإشعار داخل منصة الطلبة فور اعتماد الحملة.'}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                        اختر قناة مراسلة واحدة على الأقل للمتابعة إلى الخطوة التالية.
                      </div>
                    )}
                  </section>
                )}

                {bulkStep === 2 && (
                  <section className="space-y-6">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">٢. الجمهور المستهدف</h3>
                      <p className="mt-1 text-sm text-gray-500">
                        حدّد الفئة التي ترغب في مراسلتها باستخدام المرشحات المتاحة أو قائمة مخصصة.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                      <div className="space-y-4 lg:col-span-2">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-gray-700">طريقة تحديد الجمهور</label>
                          <select
                            name="audienceType"
                            value={bulkData.audienceType}
                            onChange={handleBulkInputChange}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="all">جميع الطلبة</option>
                            <option value="department">بحسب الأقسام الدراسية</option>
                            <option value="stage">بحسب المرحلة الدراسية</option>
                            <option value="semester">بحسب الفصل الدراسي</option>
                            <option value="newStudents">الطلبة الجدد (قيد التسجيل)</option>
                            <option value="custom">قائمة مخصصة</option>
                          </select>
                        </div>

                        {bulkData.audienceType === 'department' && (
                          <div className="space-y-4">
                            <p className="text-sm font-medium text-gray-700">اختر الأقسام المستهدفة</p>
                            {isMetadataLoading ? (
                              <div className="rounded-lg border border-dashed border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
                                يتم تحميل بيانات الأقسام...
                              </div>
                            ) : metadata.departments.length ? (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {metadata.departments.map((department) => {
                                  const isSelected = bulkData.selectedDepartments.includes(department.id);
                                  return (
                                    <label
                                      key={department.id}
                                      className={`flex h-full cursor-pointer flex-col justify-between rounded-lg border px-3 py-3 transition ${
                                        isSelected ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-indigo-200'
                                      }`}
                                    >
                                      <div className="space-y-1">
                                        <p className="text-sm font-semibold text-gray-800">{department.name}</p>
                                        <p className="text-xs text-gray-500">{department.count.toLocaleString()} طالب مسجل</p>
                                      </div>
                                      <input
                                        type="checkbox"
                                        className="mt-2 h-4 w-4 self-end rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                        checked={isSelected}
                                        onChange={() => toggleBulkDepartment(department.id)}
                                      />
                                    </label>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                                {metadataError || 'لا توجد بيانات أقسام متاحة حالياً. تأكد من تسجيل الأقسام في النظام.'}
                              </div>
                            )}

                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                              <div>
                                <label className="mb-2 block text-sm font-medium text-gray-700">المرحلة الدراسية</label>
                                <select
                                  name="selectedStage"
                                  value={bulkData.selectedStage}
                                  onChange={handleBulkInputChange}
                                  disabled={isMetadataLoading || !departmentStageOptions.length}
                                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                                >
                                  <option value="">
                                    {isMetadataLoading
                                      ? 'جارٍ تحميل المراحل...'
                                      : departmentStageOptions.length
                                      ? 'اختر المرحلة'
                                      : 'لا توجد مراحل مرتبطة بالأقسام المختارة'}
                                  </option>
                                  {departmentStageOptions.map((stage) => (
                                    <option key={stage.id} value={stage.id}>
                                      {stage.name} ({stage.total.toLocaleString()} طالب)
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="mb-2 block text-sm font-medium text-gray-700">الفصل الدراسي</label>
                                <select
                                  name="selectedSemester"
                                  value={bulkData.selectedSemester}
                                  onChange={handleBulkInputChange}
                                  disabled={
                                    isMetadataLoading ||
                                    !bulkData.selectedStage ||
                                    !departmentStageOptions.some((stage) => stage.id === bulkData.selectedStage)
                                  }
                                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                                >
                                  <option value="">
                                    {bulkData.selectedStage ? 'اختر الفصل' : 'يرجى اختيار المرحلة أولاً'}
                                  </option>
                                  {departmentStageOptions
                                    .find((stage) => stage.id === bulkData.selectedStage)
                                    ?.semesters.map((semester) => (
                                      <option key={semester.id} value={semester.id}>
                                        {semester.name} ({semester.count.toLocaleString()} طالب)
                                      </option>
                                    ))}
                                </select>
                              </div>
                            </div>
                          </div>
                        )}

                        {bulkData.audienceType === 'stage' && (
                          <div className="space-y-4">
                            <div>
                              <label className="mb-2 block text-sm font-medium text-gray-700">المرحلة الدراسية</label>
                              <select
                                name="selectedStage"
                                value={bulkData.selectedStage}
                                onChange={handleBulkInputChange}
                                disabled={isMetadataLoading || !metadata.stages.length}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                              >
                                <option value="">
                                  {isMetadataLoading
                                    ? 'جارٍ تحميل المراحل...'
                                    : metadata.stages.length
                                    ? 'اختر المرحلة'
                                    : 'لا توجد مراحل متاحة'}
                                </option>
                                {metadata.stages.map((stage) => (
                                  <option key={stage.id} value={stage.id}>
                                    {stage.name} ({stage.total.toLocaleString()} طالب)
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )}

                        {bulkData.audienceType === 'semester' && (
                          <div className="space-y-4">
                            <div>
                              <label className="mb-2 block text-sm font-medium text-gray-700">المرحلة الدراسية</label>
                              <select
                                name="selectedStage"
                                value={bulkData.selectedStage}
                                onChange={handleBulkInputChange}
                                disabled={isMetadataLoading || !metadata.stages.length}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                              >
                                <option value="">
                                  {isMetadataLoading
                                    ? 'جارٍ تحميل المراحل...'
                                    : metadata.stages.length
                                    ? 'اختر المرحلة'
                                    : 'لا توجد مراحل متاحة'}
                                </option>
                                {metadata.stages.map((stage) => (
                                  <option key={stage.id} value={stage.id}>
                                    {stage.name} ({stage.total.toLocaleString()} طالب)
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="mb-2 block text-sm font-medium text-gray-700">الفصل الدراسي</label>
                              <select
                                name="selectedSemester"
                                value={bulkData.selectedSemester}
                                onChange={handleBulkInputChange}
                                disabled={isMetadataLoading || !bulkData.selectedStage}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
                              >
                                <option value="">
                                  {bulkData.selectedStage ? 'اختر الفصل' : 'يرجى اختيار المرحلة أولاً'}
                                </option>
                                {metadata.stages
                                  .find((stage) => stage.id === bulkData.selectedStage)
                                  ?.semesters.map((semester) => (
                                    <option key={semester.id} value={semester.id}>
                                      {semester.name} ({semester.count.toLocaleString()} طالب)
                                    </option>
                                  ))}
                              </select>
                            </div>
                          </div>
                        )}

                        {bulkData.audienceType === 'custom' && (
                          <div className="space-y-4">
                            <div>
                              <label className="mb-2 block text-sm font-medium text-gray-700">ابحث عن الطلبة لإضافتهم</label>
                              <div className="flex flex-col gap-2 sm:flex-row">
                                <input
                                  type="text"
                                  value={customSearchQuery}
                                  onChange={(e) => setCustomSearchQuery(e.target.value)}
                                  placeholder="اكتب اسم الطالب أو رقمه الجامعي أو رقم الهاتف..."
                                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                                />
                                {customSearchQuery && (
                                  <button
                                    type="button"
                                    onClick={() => setCustomSearchQuery('')}
                                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
                                  >
                                    مسح البحث
                                  </button>
                                )}
                              </div>
                              <p className="mt-1 text-xs text-gray-500">
                                يعرض النظام أول 20 نتيجة مطابقة. أضف الطلبة واحداً تلو الآخر إلى القائمة المخصصة.
                              </p>
                            </div>

                            <div className="rounded-lg border border-gray-200 bg-white">
                              {isCustomSearchLoading ? (
                                <div className="px-4 py-4 text-sm text-gray-500">جارٍ البحث عن الطلبة...</div>
                              ) : customSearchQuery.trim() && !customSearchResults.length ? (
                                <div className="px-4 py-4 text-sm text-gray-500">
                                  لم يتم العثور على طلبة مطابقين. تأكد من صحة الاسم أو الرقم المدخل.
                                </div>
                              ) : (
                                <ul className="divide-y divide-gray-100">
                                  {customSearchResults.map((student) => (
                                    <li key={student.id} className="flex items-center justify-between px-4 py-3">
                                      <div>
                                        <p className="text-sm font-medium text-gray-800">{student.name}</p>
                                        <p className="text-xs text-gray-500">
                                          {student.id}
                                          {student.phone ? ` • ${student.phone}` : ''}
                                          {student.department ? ` • ${student.department}` : ''}
                                        </p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleAddCustomStudent(student)}
                                        className="rounded-lg border border-indigo-500 px-3 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50"
                                      >
                                        إضافة
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>

                            {customSelectedStudents.length > 0 && (
                              <div className="rounded-lg border border-indigo-200 bg-indigo-50">
                                <div className="border-b border-indigo-200 px-4 py-2 text-sm font-semibold text-indigo-800">
                                  الطلبة المختارون ({customSelectedStudents.length})
                                </div>
                                <ul className="divide-y divide-indigo-100">
                                  {customSelectedStudents.map((student) => (
                                    <li key={student.id} className="flex items-center justify-between px-4 py-3">
                                      <div>
                                        <p className="text-sm font-medium text-indigo-900">{student.name}</p>
                                        <p className="text-xs text-indigo-600">
                                          {student.id}
                                          {student.phone ? ` • ${student.phone}` : ''}
                                        </p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveCustomStudent(student.id)}
                                        className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                                      >
                                        إزالة
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <h4 className="text-sm font-semibold text-gray-700 mb-2">ملخص الجمهور المستهدف</h4>
                        <p className="text-base font-bold text-gray-900">{audienceSummary.title}</p>
                        <p className="mt-2 text-sm text-gray-600 leading-relaxed">{audienceSummary.description}</p>
                        <div className="mt-4 flex items-center justify-between">
                          <span className="text-xs text-gray-500">تقدير عدد المستلمين</span>
                          <span className="text-lg font-semibold text-indigo-600">
                            {typeof audienceSummary.count === 'number'
                              ? audienceSummary.count.toLocaleString()
                              : '—'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-xs text-gray-500">
                      {isWhatsAppChannel
                        ? 'بعد تثبيت الجمهور سيعرض النظام قائمة المستلمين مع أزرار واتساب فردية في الخطوة التالية.'
                        : 'يمكنك تعديل خيارات الجمهور في أي وقت قبل الإطلاق، وسيتم حفظ الإعدادات تلقائياً.'}
                    </div>
                  </section>
                )}

                {bulkStep === 3 && (
                  <form onSubmit={handleBulkSubmit} className="space-y-8">
                    <section className="space-y-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">٣. تفاصيل الحملة</h3>
                          <p className="mt-1 text-sm text-gray-500">
                            صِغ المحتوى النهائي وحدد الأولوية، ثم استعرض قائمة المستلمين قبل الإطلاق.
                          </p>
                        </div>
                        <span
                          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${getPriorityColor(
                            bulkData.priority
                          )}`}
                        >
                          أولوية الحملة:{' '}
                          {bulkData.priority === 'urgent'
                            ? 'عاجلة'
                            : bulkData.priority === 'high'
                            ? 'عالية'
                            : bulkData.priority === 'medium'
                            ? 'متوسطة'
                            : 'منخفضة'}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-gray-700">عنوان الحملة</label>
                          <input
                            type="text"
                            name="title"
                            value={bulkData.title}
                            onChange={handleBulkInputChange}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                            placeholder="مثال: تذكير بموعد استلام البطاقات الجامعية"
                            required
                          />
                          <p className="mt-1 text-xs text-gray-500">يظهر العنوان في القنوات الداعمة له مثل البريد الإلكتروني.</p>
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-gray-700">أولوية المعالجة</label>
                          <select
                            name="priority"
                            value={bulkData.priority}
                            onChange={handleBulkInputChange}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="low">منخفضة</option>
                            <option value="medium">متوسطة</option>
                            <option value="high">عالية</option>
                            <option value="urgent">عاجلة</option>
                          </select>
                          <p className="mt-1 text-xs text-gray-500">تساعد الأولوية العالية الفرق الداخلية على متابعة الإرسال سريعاً.</p>
                        </div>
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-gray-700">المحتوى الرئيسي</label>
                        <textarea
                          name="message"
                          value={bulkData.message}
                          onChange={handleBulkInputChange}
                          rows={6}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                          placeholder="اكتب نص الحملة مع استخدام المتغيرات الديناميكية مثل {{اسم_الطالب}}، {{الرقم_الجامعي}}."
                          required
                        />
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                          <span className="rounded bg-gray-100 px-2 py-1">{'{{اسم_الطالب}}'}</span>
                          <span className="rounded bg-gray-100 px-2 py-1">{'{{الرقم_الجامعي}}'}</span>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-700">معاينة المستلمين</h4>
                          <p className="text-xs text-gray-500">
                            يتم استخراج الأرقام من النظام مباشرة. استخدم الزر أدناه لتحديث القائمة عند الحاجة.
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span>القناة المختارة:</span>
                            {selectedPrimaryChannel ? renderChannelBadge(selectedPrimaryChannel) : <span>—</span>}
                          </div>
                          <button
                            type="button"
                            onClick={() => fetchAudiencePreview(true)}
                            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
                            disabled={isPreviewLoading}
                          >
                            {isPreviewLoading ? 'جاري التحديث...' : 'تحديث القائمة'}
                          </button>
                        </div>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50">
                        {isPreviewLoading ? (
                          <div className="px-4 py-6 text-center text-sm text-gray-500">جارٍ تحميل قائمة المستلمين...</div>
                        ) : previewError ? (
                          <div className="px-4 py-6 text-center text-sm text-red-600">{previewError}</div>
                        ) : audiencePreview.length ? (
                          <ul className="divide-y divide-gray-200">
                            {audiencePreview.map((recipient) => (
                              <li
                                key={`${recipient.id}-${recipient.phone}`}
                                className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between"
                              >
                                <div>
                                  <p className="text-sm font-semibold text-gray-800">
                                    {recipient.name || 'طالب بدون اسم مسجل'}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {recipient.id}
                                    {recipient.phone ? ` • ${recipient.phone}` : ' • لا يوجد رقم هاتف'}
                                  </p>
                                </div>
                                {isWhatsAppChannel && recipient.phone ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openWhatsAppChat(
                                        recipient.phone,
                                        personalizeMessage(bulkData.message, recipient)
                                      )
                                    }
                                    className="rounded-lg border border-green-500 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-50"
                                  >
                                    فتح واتساب
                                  </button>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <div className="px-4 py-6 text-center text-sm text-gray-500">
                            لم يتم العثور على مستلمين مطابقين. تحقق من إعدادات الجمهور أو حدّث القائمة.
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="flex flex-col gap-3 border-t pt-6 md:flex-row md:items-center md:justify-between">
                      <div className="text-xs text-gray-500">
                        سيتم حفظ الحملة ثم معالجتها وفق الإعدادات الحالية. يمكنك الرجوع لأي خطوة قبل الإطلاق النهائي.
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={handleBulkStepBack}
                          className="rounded-lg border border-gray-300 px-5 py-2 text-sm text-gray-600 hover:bg-gray-100"
                          disabled={isSavingCampaign}
                        >
                          الرجوع
                        </button>
                        <button
                          type="submit"
                          disabled={isSavingCampaign}
                          className={`rounded-lg px-5 py-2 text-sm font-semibold text-white transition-colors ${
                            isSavingCampaign ? 'bg-indigo-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
                          }`}
                        >
                          {isSavingCampaign ? 'جاري حفظ الحملة...' : 'تأكيد وإطلاق الحملة'}
                        </button>
                      </div>
                    </section>
                  </form>
                )}

                {bulkStep < 3 && (
                  <div className="flex items-center justify-between border-t pt-6">
                    <button
                      type="button"
                      onClick={handleBulkStepBack}
                      className={`rounded-lg border px-5 py-2 text-sm ${
                        bulkStep === 1
                          ? 'cursor-not-allowed border-gray-200 text-gray-300'
                          : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                      }`}
                      disabled={bulkStep === 1}
                    >
                      الرجوع
                    </button>
                    <button
                      type="button"
                      onClick={handleBulkStepNext}
                      className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                    >
                      التالي
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-5 5v-5zM4 19h6v-6H4v6zM4 5h6V1H4v4zM15 5h5v6h-5V5z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-800 mb-2">هل تريد إطلاق حملة جديدة؟</h3>
                <p className="text-gray-600 mb-6">
                  ابدأ المراسلات الجماعية باختيار القنوات المناسبة واستهداف الجمهور المطلوب بخطوات واضحة.
                </p>
                <button
                  onClick={() => setShowBulkForm(true)}
                  className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-lg transition"
                >
                  إنشاء حملة مراسلات
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'individual' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">مراسلة طالب محدد</h2>
                <p className="text-sm text-gray-500">ارسل إشعاراً مباشراً مع اختيار القنوات المناسبة وتتبّع الردود.</p>
              </div>
              <button
                onClick={() => setShowIndividualForm(!showIndividualForm)}
                className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
              >
                {showIndividualForm ? 'إلغاء' : 'إرسال رسالة فردية'}
              </button>
            </div>

            {showIndividualForm ? (
              <form onSubmit={handleIndividualSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">معلومات الطالب</h3>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">رقم الطالب</label>
                      <input
                        type="text"
                        name="studentId"
                        value={individualData.studentId}
                        onChange={handleIndividualInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">اسم الطالب</label>
                      <input
                        type="text"
                        name="studentName"
                        value={individualData.studentName}
                        onChange={handleIndividualInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">تفاصيل الرسالة</h3>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">موضوع الرسالة</label>
                      <input
                        type="text"
                        name="subject"
                        value={individualData.subject}
                        onChange={handleIndividualInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">نوع الرسالة</label>
                      <select
                        name="messageType"
                        value={individualData.messageType}
                        onChange={handleIndividualInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        required
                      >
                        <option value="notification">إشعار</option>
                        <option value="warning">تحذير</option>
                        <option value="reminder">تذكير</option>
                        <option value="announcement">إعلان</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">أولوية الرسالة</label>
                      <select
                        name="priority"
                        value={individualData.priority}
                        onChange={handleIndividualInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        required
                      >
                        <option value="low">منخفضة</option>
                        <option value="medium">متوسطة</option>
                        <option value="high">عالية</option>
                        <option value="urgent">عاجلة</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">محتوى الرسالة</label>
                  <textarea
                    name="message"
                    value={individualData.message}
                    onChange={handleIndividualInputChange}
                    rows={6}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                    placeholder="اكتب محتوى الرسالة هنا"
                    required
                  />
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-800 border-b pb-2">قنوات الإرسال</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Object.entries(CHANNEL_OPTIONS).map(([key, option]) => (
                      <label
                        key={key}
                        className={`relative border rounded-lg px-4 py-3 cursor-pointer transition-all ${
                          individualData.channels.includes(key as Channel)
                            ? 'border-purple-500 bg-purple-50 shadow-sm'
                            : 'border-gray-200 hover:border-purple-200'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                  <div>
                            <p className="text-sm font-semibold text-gray-800">{option.label}</p>
                            <p className="text-xs text-gray-500 mt-1">{option.description}</p>
                          </div>
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                            checked={individualData.channels.includes(key as Channel)}
                            onChange={() => toggleIndividualChannel(key as Channel)}
                          />
                        </div>
                    </label>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">يمكن إرسال الرسالة عبر أكثر من قناة لضمان وصولها.</p>

                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      name="isScheduled"
                      checked={individualData.isScheduled}
                      onChange={handleIndividualInputChange}
                      className="h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                    />
                    <label className="mr-2 block text-sm text-gray-700">جدولة الإرسال</label>
                  </div>

                  {individualData.isScheduled && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">تاريخ الإرسال</label>
                        <input
                          type="date"
                          name="scheduledDate"
                          value={individualData.scheduledDate}
                          onChange={handleIndividualInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">وقت الإرسال</label>
                        <input
                          type="time"
                          name="scheduledTime"
                          value={individualData.scheduledTime}
                          onChange={handleIndividualInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-end space-x-4 space-x-reverse pt-6 border-t">
                  <button
                    type="button"
                    onClick={() => setShowIndividualForm(false)}
                    className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors duration-200"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors duration-200"
                  >
                    إرسال الرسالة
                  </button>
                </div>
              </form>
            ) : (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-800 mb-2">إرسال رسالة فردية جديدة</h3>
                <p className="text-gray-600 mb-6">اضغط على &quot;إرسال رسالة فردية&quot; لبدء التواصل مع الطالب المحدد.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'orgUnits' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">مراسلة الوحدات والأقسام</h2>
            <p className="text-sm text-gray-500 mb-6">الميزة قيد التطوير، سنضيف اختيار الوحدات والشُعب وقنوات الإرسال قريباً.</p>
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
              سنتيح قريباً تحديد الأقسام والوحدات والإرسال الجماعي (نص/واتساب/إشعار) مع قوالب ملائمة للإدارات.
            </div>
          </div>
        )}

        {activeTab === 'faculty' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">مراسلة الأساتذة</h2>
            <p className="text-sm text-gray-500 mb-6">الميزة قيد التطوير، سنضيف اختيار الأساتذة حسب الأقسام أو المقررات قريباً.</p>
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
              سنتيح قريباً استهداف أعضاء الهيئة التدريسية برسائل بريد/إشعارات مع إمكانية تخصيصها حسب المقررات الدراسية.
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">إعدادات التنبيهات الفورية والقنوات</h2>
                <p className="text-sm text-gray-500">تحكّم في تفعيل القنوات، نوع الإشعارات، والتكامل مع الأنظمة الأخرى.</p>
              </div>
              <button
                onClick={() => setShowSettingsForm(!showSettingsForm)}
                className="bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
              >
                {showSettingsForm ? 'إلغاء' : 'تعديل الإعدادات'}
              </button>
            </div>

            {showSettingsForm ? (
              <form onSubmit={handleSettingsSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">طرق الإشعارات</h3>
                    <div className="space-y-3">
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          name="emailNotifications"
                          checked={settingsData.emailNotifications}
                          onChange={handleSettingsInputChange}
                          className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">الإشعارات عبر البريد الإلكتروني</span>
                        </label>
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          name="systemNotifications"
                          checked={settingsData.systemNotifications}
                          onChange={handleSettingsInputChange}
                          className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">الإشعارات داخل النظام</span>
                        </label>
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          name="pushNotifications"
                          checked={settingsData.pushNotifications}
                          onChange={handleSettingsInputChange}
                          className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">الإشعارات الفورية (Push)</span>
                        </label>
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          name="smsNotifications"
                          checked={settingsData.smsNotifications}
                          onChange={handleSettingsInputChange}
                          className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">الإشعارات عبر الرسائل النصية</span>
                        </label>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">أنواع الإشعارات</h3>
                    <div className="grid grid-cols-1 gap-3">
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          name="notificationTypes.academic"
                          checked={settingsData.notificationTypes.academic}
                          onChange={handleSettingsInputChange}
                          className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">الإشعارات الأكاديمية</span>
                        </label>
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          name="notificationTypes.administrative"
                          checked={settingsData.notificationTypes.administrative}
                          onChange={handleSettingsInputChange}
                          className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">الإشعارات الإدارية</span>
                        </label>
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          name="notificationTypes.financial"
                          checked={settingsData.notificationTypes.financial}
                          onChange={handleSettingsInputChange}
                          className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">الإشعارات المالية</span>
                        </label>
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          name="notificationTypes.events"
                          checked={settingsData.notificationTypes.events}
                          onChange={handleSettingsInputChange}
                          className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">إشعارات الفعاليات</span>
                        </label>
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          name="notificationTypes.warnings"
                          checked={settingsData.notificationTypes.warnings}
                          onChange={handleSettingsInputChange}
                          className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">إشعارات التحذيرات</span>
                        </label>
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          name="notificationTypes.reminders"
                          checked={settingsData.notificationTypes.reminders}
                          onChange={handleSettingsInputChange}
                          className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">إشعارات التذكيرات</span>
                        </label>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-800 border-b pb-2">ساعات الهدوء</h3>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      name="quietHours.enabled"
                      checked={settingsData.quietHours.enabled}
                      onChange={handleSettingsInputChange}
                      className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-700">تفعيل ساعات الهدوء</span>
                    </label>

                  {settingsData.quietHours.enabled && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">وقت البداية</label>
                        <input
                          type="time"
                          name="quietHours.startTime"
                          value={settingsData.quietHours.startTime}
                          onChange={handleSettingsInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">وقت النهاية</label>
                        <input
                          type="time"
                          name="quietHours.endTime"
                          value={settingsData.quietHours.endTime}
                          onChange={handleSettingsInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-800 border-b pb-2">التكاملات واللغة</h3>
                  <label className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      name="autoSyncExternalSystems"
                      checked={settingsData.autoSyncExternalSystems}
                      onChange={handleSettingsInputChange}
                      className="h-4 w-4 text-pink-600 focus:ring-pink-500 border-gray-300 rounded"
                    />
                    <span className="text-sm text-gray-700">مزامنة تلقائية مع الأنظمة المتكاملة عند كل حملة</span>
                  </label>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">لغة الإشعارات الافتراضية</label>
                  <select
                    name="language"
                    value={settingsData.language}
                    onChange={handleSettingsInputChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                  >
                    <option value="ar">العربية</option>
                    <option value="en">English</option>
                  </select>
                  </div>
                </div>

                <div className="flex justify-end space-x-4 space-x-reverse pt-6 border-t">
                  <button
                    type="button"
                    onClick={() => setShowSettingsForm(false)}
                    className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors duration-200"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors duration-200"
                  >
                    حفظ الإعدادات
                  </button>
                </div>
              </form>
            ) : (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-pink-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-pink-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-800 mb-2">إعدادات التنبيهات الفورية</h3>
                <p className="text-gray-600 mb-6">اضغط على &quot;تعديل الإعدادات&quot; لتخصيص القنوات والتكاملات وساعات الهدوء.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">سجل الحملات والمراسلات</h2>
                <p className="text-sm text-gray-500">
                  متابعة حالة الحملات والقنوات ونتائج الإرسال لكل قناة.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleRefreshCampaigns}
                  disabled={campaignsLoading}
                  className={`px-4 py-2 rounded-lg text-white transition-colors duration-200 ${
                    campaignsLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-gray-700 hover:bg-gray-800'
                  }`}
                >
                  {campaignsLoading ? 'جاري التحديث...' : 'تحديث القائمة'}
                </button>
                <button
                  type="button"
                  onClick={handleExpandAllCampaigns}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-600 hover:bg-gray-100"
                  disabled={!campaigns.length}
                >
                  فتح الكل
                </button>
                <button
                  type="button"
                  onClick={handleCollapseAllCampaigns}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-600 hover:bg-gray-100"
                  disabled={!campaigns.length}
                >
                  إغلاق الكل
                </button>
              </div>
            </div>

            {campaignsError && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {campaignsError}
            </div>
            )}

            {!campaignsError && campaignsLoading && campaigns.length === 0 && (
              <p className="text-center text-sm text-gray-500 py-8">جاري تحميل الحملات...</p>
            )}

            {!campaignsLoading && !campaignsError && campaigns.length === 0 && (
              <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">
                لا توجد حملات مراسلات مسجلة حتى الآن. ابدأ بحملة جديدة لمشاهدة النتائج هنا.
              </div>
            )}

            <div className="space-y-6">
              {campaigns.map((campaign) => {
                const totalSuccess = campaign.channels.reduce((acc, channel) => acc + channel.successCount, 0);
                const totalFailed = campaign.channels.reduce((acc, channel) => acc + channel.failedCount, 0);
                const audienceLabel = AUDIENCE_TYPE_LABELS[campaign.audienceType] || campaign.audienceType;
                const whatsappChannel = campaign.channels.find((channel) => channel.channelType === 'whatsapp');
                const deliveredRecipients = new Set(
                  (whatsappChannel?.deliveries || [])
                    .filter((delivery) => delivery.status === 'success' && delivery.recipient)
                    .map((delivery) => normalizePhone(delivery.recipient!))
                );
                const isExpanded = expandedCampaignIds.includes(campaign.id);

                return (
                  <div key={campaign.id} className="rounded-lg border border-gray-200 bg-white shadow-sm">
                    <button
                      type="button"
                      onClick={() => handleToggleCampaignExpansion(campaign.id)}
                      className="w-full flex items-center justify-between gap-3 px-5 py-4 text-right transition-colors hover:bg-gray-50"
                    >
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-700">{campaign.title}</span>
                          <span className="text-xs text-gray-400">{formatDateTime(campaign.createdAt)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-semibold ${getPriorityColor(
                              campaign.priority
                            )}`}
                          >
                            أولوية: {campaign.priority === 'urgent'
                              ? 'عاجلة'
                              : campaign.priority === 'high'
                              ? 'عالية'
                              : campaign.priority === 'medium'
                              ? 'متوسطة'
                              : 'منخفضة'}
                          </span>
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 font-semibold text-gray-700">
                            الجمهور: {audienceLabel}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-semibold ${getCampaignStatusColor(
                              campaign.status
                            )}`}
                          >
                            الحالة: {CAMPAIGN_STATUS_LABELS[campaign.status] || campaign.status}
                          </span>
                        </div>
                      </div>
                      <span className="text-gray-500">
                        {isExpanded ? (
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : (
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-200 px-5 py-4 space-y-4">
                        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                          <div className="space-y-2 text-sm text-gray-700">
                            <p className="leading-relaxed text-gray-600">{campaign.message}</p>
                          </div>
                          <div className="text-sm text-gray-600 space-y-1">
                            <p>
                              <span className="font-semibold text-gray-800">أنشئت:</span>{' '}
                              {formatDateTime(campaign.createdAt)}
                            </p>
                            {campaign.sentAt && (
                              <p>
                                <span className="font-semibold text-gray-800">آخر إرسال:</span>{' '}
                                {formatDateTime(campaign.sentAt)}
                              </p>
                            )}
                            <p>
                              <span className="font-semibold text-gray-800">إجمالي القنوات:</span>{' '}
                              {campaign.channels.length}
                            </p>
                            <p>
                              <span className="font-semibold text-gray-800">النجاحات:</span> {totalSuccess}{' '}
                              <span className="mx-1 text-gray-400">|</span>
                              <span className="font-semibold text-gray-800">الإخفاقات:</span> {totalFailed}
                            </p>
                            <p>
                              <span className="font-semibold text-gray-800">المستلمين:</span>{' '}
                              {campaign.totalRecipients != null ? campaign.totalRecipients.toLocaleString() : '—'}
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {campaign.channels.map((channel) => (
                            <div key={channel.id} className="border border-gray-200 rounded-lg bg-gray-50 p-4">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-semibold text-gray-800">
                                  {CHANNEL_LABELS[channel.channelType] || channel.channelType}
                                </span>
                                <span
                                  className={`inline-flex items-center px-2.5 py-1 text-xs font-semibold rounded-full ${getStatusColor(
                                    channel.status
                                  )}`}
                                >
                                  {channel.status === 'sent'
                                    ? 'تم الإرسال'
                                    : channel.status === 'pending'
                                    ? 'قيد التنفيذ'
                                    : channel.status === 'processing'
                                    ? 'جاري الإرسال'
                                    : channel.status === 'failed'
                                    ? 'فشل'
                                    : channel.status === 'scheduled'
                                    ? 'مجدول'
                                    : channel.status === 'cancelled'
                                    ? 'ملغاة'
                                    : channel.status}
                                </span>
                              </div>
                              <div className="mt-3 space-y-1 text-sm text-gray-600">
                                <p>
                                  <span className="font-semibold text-gray-700">نجاح:</span>{' '}
                                  {channel.successCount.toLocaleString()}{' '}
                                  <span className="mx-1 text-gray-400">|</span>
                                  <span className="font-semibold text-gray-700">فشل:</span>{' '}
                                  {channel.failedCount.toLocaleString()}
                                </p>
                                <p>
                                  <span className="font-semibold text-gray-700">آخر محاولة:</span>{' '}
                                  {formatDateTime(channel.lastAttemptAt || channel.lastDeliveryAt || channel.updatedAt)}
                                </p>
                                {channel.lastError && (
                                  <p className="text-xs text-red-600">
                                    <span className="font-semibold text-red-700">آخر خطأ:</span> {channel.lastError}
                                  </p>
                                )}
                                {channel.senderProfile && (
                                  <p className="text-xs text-gray-500">
                                    معرّف المرسل: {channel.senderProfile}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        {campaign.recipients.length > 0 && whatsappChannel && (
                          <div className="border border-dashed border-green-300 bg-green-50 rounded-lg p-4">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
                              <div>
                                <h4 className="text-sm font-semibold text-green-800">
                                  الإرسال اليدوي عبر واتساب (عدد المستلمين {campaign.recipients.length})
                                </h4>
                                <p className="text-xs text-green-700">
                                  اضغط على &quot;فتح واتساب&quot; لكل رقم، ثم بعد الإرسال اضغط &quot;تسجيل الإرسال&quot; لتحديث السجل.
                                </p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  disabled={!campaign.recipients.length}
                                  onClick={() => openGroupSendModal(campaign, whatsappChannel, deliveredRecipients)}
                                  className={`px-3 py-1.5 text-sm rounded-md border transition-colors duration-200 ${
                                    campaign.recipients.length
                                      ? 'border-green-600 text-green-700 hover:bg-green-100'
                                      : 'border-gray-300 text-gray-400 cursor-not-allowed'
                                  }`}
                                >
                                  إرسال واتساب جماعي
                                </button>
                              </div>
                            </div>
                            <div className="space-y-2">
                              {campaign.recipients.map((recipient) => {
                                const phoneDigits = normalizePhone(recipient.phone);
                                const isSent = deliveredRecipients.has(phoneDigits);
                                const isSending = manualSendingKey === `${campaign.id}-${phoneDigits}`;
                                return (
                                  <div
                                    key={`${campaign.id}-${recipient.id}-${recipient.phone}`}
                                    className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border border-green-200 rounded-md bg-white px-3 py-2"
                                  >
                                    <div className="text-sm text-gray-700">
                                      <span className="font-semibold text-gray-900">
                                        {recipient.name ? `${recipient.name} — ${recipient.phone}` : recipient.phone}
                                      </span>
                                      {isSent ? (
                                        <span className="ml-2 inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                                          تم الإرسال
                                        </span>
                                      ) : (
                                        <span className="ml-2 inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-700">
                                          بانتظار الإرسال
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openWhatsAppChat(
                                            recipient.phone,
                                            personalizeMessage(
                                              campaign.message,
                                              recipient
                                            )
                                          )
                                        }
                                        className="px-3 py-1 text-sm rounded-md border border-green-500 text-green-700 hover:bg-green-100 transition-colors duration-200"
                                      >
                                        فتح واتساب
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isSent || isSending || !phoneDigits}
                                        onClick={() =>
                                          handleManualDelivery(
                                            campaign.id,
                                            whatsappChannel.id,
                                            recipient.phone,
                                            personalizeMessage(campaign.message, recipient)
                                          )
                                        }
                                        className={`px-3 py-1 text-sm rounded-md transition-colors duration-200 ${
                                          isSent
                                            ? 'bg-green-500 text-white cursor-default'
                                            : isSending
                                            ? 'bg-green-300 text-white cursor-wait'
                                            : 'bg-green-600 text-white hover:bg-green-700'
                                        }`}
                                      >
                                        {isSent ? 'مُسجّل' : isSending ? 'جاري التسجيل...' : 'تسجيل الإرسال'}
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {groupSendContext && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
          <div className="w-full max-w-4xl bg-white rounded-xl shadow-2xl border border-gray-200">
            <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">إرسال واتساب جماعي</h3>
                <p className="text-sm text-gray-600 mt-1">
                  الحملة:{' '}
                  <span className="font-medium text-gray-800">{groupSendContext.title}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={closeGroupSendModal}
                className="text-gray-400 hover:text-gray-600 transition-colors duration-200"
                disabled={isGroupSending || isBatchRecording}
              >
                <span className="sr-only">إغلاق</span>
                <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M6 6l8 8M6 14L14 6"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              <p className="text-sm text-gray-500 bg-green-50 border border-green-100 rounded-lg px-4 py-3">
                اختر المستلمين ثم اضغط &quot;بدء فتح المحادثات&quot; لفتح أول محادثة واتساب، وبعد الانتهاء اضغط &quot;فتح المحادثة التالية&quot;
                للانتقال إلى من تبقّى. بعد الإرسال يمكنك استخدام زر &quot;تسجيل الجميع كمُرسَل&quot; لتحديث السجل تلقائيًا.
              </p>

              {groupSendError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {groupSendError}
                </div>
              )}

              {groupSendSuccess && (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                  {groupSendSuccess}
                </div>
              )}

              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="text-sm text-gray-600">
                  تم اختيار{' '}
                  <span className="font-semibold text-gray-900">
                    {selectedGroupRecipients.length.toLocaleString()}
                  </span>{' '}
                  مستلم، منهم{' '}
                  <span className="font-semibold text-gray-900">
                    {pendingSelectedRecipientsCount.toLocaleString()}
                  </span>{' '}
                  غير مسجل كمرسل إليهم حتى الآن. المتبقون في قائمة الانتظار حالياً:{' '}
                  <span className="font-semibold text-gray-900">
                    {remainingQueueCount.toLocaleString()}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setAllGroupRecipients(true)}
                    className="px-3 py-1.5 text-xs md:text-sm rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors duration-200"
                    disabled={isGroupSending || isBatchRecording}
                  >
                    تحديد الكل
                  </button>
                  <button
                    type="button"
                    onClick={() => setAllGroupRecipients(false)}
                    className="px-3 py-1.5 text-xs md:text-sm rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors duration-200"
                    disabled={isGroupSending || isBatchRecording}
                  >
                    إلغاء التحديد
                  </button>
                </div>
              </div>

              <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-200">
                {groupSendRecipients.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-gray-500">لا يوجد مستلمون مرتبطون بهذه الحملة.</p>
                ) : (
                  groupSendRecipients.map((recipient) => {
                    const key = getRecipientKey(groupSendContext.campaignId, recipient);
                    const isSelected = !!groupSendSelection[key];
                    const phoneDigits = normalizePhone(recipient.phone);
                    const isDelivered = phoneDigits ? deliveredPhonesSet.has(phoneDigits) : false;
                    const isSelectable = !!phoneDigits && !isDelivered;

                    return (
                      <label
                        key={key}
                        className={`flex items-start gap-3 px-4 py-3 transition-colors duration-150 ${
                          isSelected ? 'bg-green-50' : 'bg-white'
                        } ${!isSelectable ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                          checked={isSelected}
                          disabled={!isSelectable || isGroupSending || isBatchRecording}
                          onChange={() => toggleGroupRecipientSelection(key)}
                        />
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-800">
                            <span className="font-semibold text-gray-900">
                              {recipient.name ? `${recipient.name} — ${recipient.phone}` : recipient.phone}
                            </span>
                            {!phoneDigits && (
                              <span className="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-700">
                                رقم غير صالح
                              </span>
                            )}
                            {isDelivered && (
                              <span className="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                                مسجل كمرسل
                              </span>
                            )}
                          </div>
                          {recipient.id && (
                            <p className="text-xs text-gray-500 mt-1">الرقم الجامعي: {recipient.id}</p>
                          )}
                        </div>
                      </label>
                    );
                  })
                )}
              </div>

              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="text-xs md:text-sm text-gray-500">
                  تم فتح{' '}
                  <span className="font-semibold text-gray-800">{groupSendProgress.opened.toLocaleString()}</span>{' '}
                  من أصل{' '}
                  <span className="font-semibold text-gray-800">{groupSendProgress.total.toLocaleString()}</span>{' '}
                  محادثة خلال هذه الجلسة.
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={startGroupSend}
                    disabled={isGroupSending || !selectedGroupRecipients.length}
                    className={`px-4 py-2 rounded-md text-white transition-colors duration-200 ${
                      isGroupSending || !selectedGroupRecipients.length
                        ? 'bg-green-300 cursor-not-allowed'
                        : 'bg-green-600 hover:bg-green-700'
                    }`}
                  >
                    {isGroupSending ? 'جارٍ التحضير...' : 'بدء فتح المحادثات'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openNextGroupChat()}
                    disabled={isGroupSending || remainingQueueCount === 0}
                    className={`px-4 py-2 rounded-md border transition-colors duration-200 ${
                      isGroupSending || remainingQueueCount === 0
                        ? 'border-gray-300 text-gray-400 cursor-not-allowed'
                        : 'border-green-500 text-green-700 hover:bg-green-50'
                    }`}
                  >
                    فتح المحادثة التالية
                  </button>
                  <button
                    type="button"
                    onClick={handleBatchDeliveryRegistration}
                    disabled={isBatchRecording || pendingSelectedRecipientsCount === 0}
                    className={`px-4 py-2 rounded-md text-white transition-colors duration-200 ${
                      isBatchRecording || pendingSelectedRecipientsCount === 0
                        ? 'bg-emerald-300 cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}
                  >
                    {isBatchRecording ? 'جارٍ التسجيل...' : 'تسجيل الجميع كمُرسَل'}
                  </button>
                  <button
                    type="button"
                    onClick={closeGroupSendModal}
                    className="px-4 py-2 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-100 transition-colors duration-200"
                    disabled={isGroupSending || isBatchRecording}
                  >
                    إغلاق
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
