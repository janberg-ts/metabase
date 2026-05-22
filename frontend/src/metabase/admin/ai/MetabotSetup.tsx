import {
  type ChangeEvent,
  type MutableRefObject,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { P, match } from "ts-pattern";
import { c, t } from "ttag";
import _ from "underscore";

import { SettingsSection } from "metabase/admin/components/SettingsSection";
import { SetByEnvVar } from "metabase/admin/settings/components/widgets/AdminSettingInput";
import {
  skipToken,
  useGetMetabotSettingsQuery,
  useUpdateMetabotSettingsMutation,
  useUpdateSettingsMutation,
} from "metabase/api";
import {
  getErrorMessage,
  useAdminSetting,
  useAdminSettings,
} from "metabase/api/utils";
import { ConfirmModal } from "metabase/common/components/ConfirmModal";
import { ExternalLink } from "metabase/common/components/ExternalLink";
import { useSetting, useToast } from "metabase/common/hooks";
import { PLUGIN_METABOT } from "metabase/plugins";
import {
  Badge,
  Button,
  type ComboboxItem,
  Flex,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
} from "metabase/ui";
import type {
  MetabotProvider,
  MetabotSettingsResponse,
  SettingDefinition,
} from "metabase-types/api";

import {
  API_KEY_SETTING_BY_PROVIDER,
  getProviderOptions,
  isAvailableProvider,
  parseProviderAndModel,
} from "./utils";

type MetabotModelOption = ComboboxItem & {
  group?: string | null;
};

const CUSTOM_AZURE_DEPLOYMENT_GROUP = "Custom";

function getModelDescription(provider: MetabotProvider | undefined) {
  if (provider === "metabase") {
    return t`Available models are provided by Metabase.`;
  }

  if (provider === "azure") {
    return t`Select the Azure Foundry deployment name that most closely matches your configured resource.`;
  }

  return t`Available models are fetched from the selected provider using its configured API key.`;
}

const DEFAULT_AZURE_API_VERSION = "2024-12-01-preview";

const MetabotSetupContext = createContext<{
  connectHandlerRef: MutableRefObject<(() => Promise<void>) | null> | null;
  disconnectHandlerRef: MutableRefObject<(() => Promise<void>) | null> | null;
  isMutating: boolean;
  isConnectButtonEnabled: boolean;
  setIsConnectButtonEnabled: (enabled: boolean) => void;
  resetProvider: VoidFunction;
  handleDisconnect: VoidFunction;
  isModal: boolean;
}>({
  isMutating: false,
  connectHandlerRef: null,
  disconnectHandlerRef: null,
  isConnectButtonEnabled: false,
  setIsConnectButtonEnabled: () => {},
  resetProvider: () => {},
  handleDisconnect: () => {},
  isModal: false,
});

export function useMetabotSetupContext(
  onConnect: (() => Promise<void>) | null,
  onDisconnect: (() => Promise<void>) | null = null,
) {
  const {
    connectHandlerRef,
    disconnectHandlerRef,
    isMutating,
    setIsConnectButtonEnabled,
    resetProvider,
    handleDisconnect,
    isModal,
  } = useContext(MetabotSetupContext);

  useEffect(() => {
    if (!connectHandlerRef) {
      return;
    }

    connectHandlerRef.current = onConnect;
    setIsConnectButtonEnabled(!!onConnect);

    return () => {
      setIsConnectButtonEnabled(false);
      connectHandlerRef.current = null;
    };
  }, [connectHandlerRef, onConnect, setIsConnectButtonEnabled]);

  useEffect(() => {
    if (!disconnectHandlerRef) {
      return;
    }

    disconnectHandlerRef.current = onDisconnect;

    return () => {
      disconnectHandlerRef.current = null;
    };
  }, [disconnectHandlerRef, onDisconnect]);

  return { isMutating, resetProvider, handleDisconnect, isModal };
}

export function MetabotSetup({ id }: { id?: string }) {
  const offerMetabaseAiManaged = PLUGIN_METABOT.isEnabled;
  const { value: savedProviderValue } = useAdminSetting("llm-metabot-provider");
  const config = useMemo(
    () => parseProviderAndModel(savedProviderValue),
    [savedProviderValue],
  );
  const isConfigured = !!useSetting("llm-metabot-configured?");
  const connectedProvider = isConfigured ? config?.provider : undefined;
  const connectedProviderSettingsQuery = useGetMetabotSettingsQuery(
    connectedProvider && connectedProvider !== "metabase"
      ? { provider: connectedProvider }
      : skipToken,
  );
  const hasApiKeyError =
    !!connectedProviderSettingsQuery.currentData?.["api-key-error"];

  return (
    <SettingsSection
      id={id}
      title={
        <Flex justify="space-between" align="center">
          <Group gap="xs" wrap="nowrap">
            {connectedProvider && (
              <Badge
                circle
                size="12"
                bg={hasApiKeyError ? "error" : "success"}
                mr="sm"
              />
            )}
            <div>
              {match({ connectedProvider, hasApiKeyError })
                .with(
                  { connectedProvider: P.nonNullable, hasApiKeyError: true },
                  ({ connectedProvider }) =>
                    t`Error connecting to ${getProviderOptions(offerMetabaseAiManaged)[connectedProvider]?.label}`,
                )
                .with(
                  { connectedProvider: P.nonNullable },
                  ({ connectedProvider }) =>
                    t`Connected to ${getProviderOptions(offerMetabaseAiManaged)[connectedProvider]?.label}`,
                )
                .with(
                  { connectedProvider: P.nullish },
                  () => t`Connect to an AI provider`,
                )
                .exhaustive()}
            </div>
          </Group>
        </Flex>
      }
      description={
        !connectedProvider
          ? t`Select your AI provider to use AI explorations, SQL generation and Metabot.`
          : undefined
      }
    >
      <MetabotSetupInner />
    </SettingsSection>
  );
}

export function MetabotSetupInner({
  isModal = false,
  onClose,
}: {
  isModal?: boolean;
  onClose?: VoidFunction;
}) {
  const MetabaseAIProviderSetup = PLUGIN_METABOT.MetabaseAIProviderSetup;
  const offerMetabaseAiManaged = PLUGIN_METABOT.isEnabled;
  const [sendToast] = useToast();

  const { value: savedProviderValue, settingDetails } = useAdminSetting(
    "llm-metabot-provider",
  );
  const isEnvSetting =
    !!settingDetails &&
    !!settingDetails.is_env_setting &&
    !!settingDetails.env_name;
  const envSettingName = isEnvSetting ? settingDetails?.env_name : undefined;

  const isConfigured = !!useSetting("llm-metabot-configured?");

  const config = useMemo(
    () => parseProviderAndModel(savedProviderValue),
    [savedProviderValue],
  );
  const connectedProvider = isConfigured ? config?.provider : undefined;
  const connectedModel = isConfigured ? config?.model : undefined;
  const [provider, setProvider] = useState<MetabotProvider | undefined>(
    isModal ? undefined : connectedProvider,
  );

  const isCurrentConfigured = connectedProvider === provider && isConfigured;

  useEffect(() => {
    if (isModal) {
      return;
    }
    setProvider(connectedProvider);
  }, [isModal, connectedProvider]);

  const [updateSettings, updateSettingsResult] = useUpdateSettingsMutation();
  const disconnectHandlerRef = useRef<(() => Promise<void>) | null>(null);

  const { details: providerApiKeyDetails } = useAdminSettings([
    "llm-anthropic-api-key",
    "llm-azure-api-key",
    "llm-openai-api-key",
    "llm-openrouter-api-key",
  ] as const);

  const disconnectProvider = useCallback(async () => {
    if (!connectedProvider) {
      return;
    }

    try {
      await disconnectHandlerRef.current?.();
    } catch {
      return;
    }

    const settingsToClear: Record<string, null> = {
      "llm-metabot-provider": null,
    };

    if (connectedProvider !== "metabase") {
      const apiKeySettingKey = API_KEY_SETTING_BY_PROVIDER[connectedProvider];
      const apiKeySetting = providerApiKeyDetails[apiKeySettingKey];

      if (!apiKeySetting?.is_env_setting) {
        settingsToClear[apiKeySettingKey] = null;
      }
    }

    try {
      const response = await updateSettings(settingsToClear);

      if (response.error) {
        const message = getErrorMessage(
          response.error,
          t`Unable to save provider settings.`,
        );

        sendToast({
          message,
          icon: "warning",
          toastColor: "error",
        });
      }
    } catch (error) {
      const message = getErrorMessage(
        error,
        t`Unable to save provider settings.`,
      );

      sendToast({
        message,
        icon: "warning",
        toastColor: "error",
      });
    }
  }, [
    connectedProvider,
    disconnectHandlerRef,
    providerApiKeyDetails,
    updateSettings,
    sendToast,
  ]);

  const providerOptions = useMemo(() => {
    const options = Object.values(getProviderOptions(offerMetabaseAiManaged));
    return options.map((option) => ({
      ...option,
      disabled: !isAvailableProvider(option.value),
    }));
  }, [offerMetabaseAiManaged]);

  const connectHandlerRef = useRef<(() => Promise<void>) | null>(null);

  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isDisconnectConfirmOpen, setIsDisconnectConfirmOpen] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const handleConnect = async () => {
    if (!connectHandlerRef.current) {
      return;
    }
    setIsConnecting(true);
    try {
      await connectHandlerRef.current();
    } finally {
      setIsConnecting(false);
    }
  };

  const resetProvider = () => {
    setProvider(undefined);
  };

  const handleDisconnect = useCallback(() => {
    setIsDisconnectConfirmOpen(true);
  }, []);

  const handleConfirmDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await disconnectProvider();
      setIsDisconnectConfirmOpen(false);
    } finally {
      setIsDisconnecting(false);
    }
  };

  const isMutating =
    isConnecting || isDisconnecting || updateSettingsResult.isLoading;

  const [isConnectButtonEnabled, setIsConnectButtonEnabled] = useState(false);

  return (
    <MetabotSetupContext.Provider
      value={{
        connectHandlerRef,
        disconnectHandlerRef,
        isMutating,
        setIsConnectButtonEnabled,
        isConnectButtonEnabled,
        resetProvider,
        handleDisconnect,
        isModal: !!isModal,
      }}
    >
      <Stack gap="md">
        {!isCurrentConfigured && (
          <Select
            label={t`Provider`}
            placeholder={t`Select a provider`}
            data={providerOptions}
            value={provider}
            onChange={setProvider}
            disabled={isEnvSetting || isMutating}
            renderOption={({ option }) => (
              <Group
                gap="xs"
                p="sm"
                justify="space-between"
                wrap="nowrap"
                w="100%"
              >
                <Text
                  lh="1rem"
                  c={option.disabled ? "text-tertiary" : undefined}
                >
                  {option.label}
                </Text>
                {!isAvailableProvider(option.value as MetabotProvider) && (
                  <Text c="text-tertiary" lh="1rem" size="sm">
                    {t`Coming soon`}
                  </Text>
                )}
              </Group>
            )}
          />
        )}

        {match(provider)
          .with("metabase", () => (
            <MetabaseAIProviderSetup onConnect={onClose} />
          ))
          .with(P.nonNullable, (selectedProvider) => (
            <AIProviderSetup
              selectedProvider={selectedProvider}
              connectedModel={connectedModel}
              isCurrentConfigured={isCurrentConfigured}
              isEnvSetting={isEnvSetting}
            />
          ))
          .with(P.nullish, () => null)
          .exhaustive()}

        {envSettingName && <SetByEnvVar varName={envSettingName} />}

        <Flex justify="end">
          {match({ isCurrentConfigured, isConnectButtonEnabled, isModal })
            .with({ isModal: true, isCurrentConfigured: true }, () => (
              <Button
                variant="filled"
                loading={isMutating}
                disabled={isMutating}
                onClick={onClose}
              >
                {t`Done`}
              </Button>
            ))
            .with(
              { isCurrentConfigured: true, isConnectButtonEnabled: false },
              () => (
                <Button
                  c="danger"
                  loading={isMutating}
                  disabled={isMutating}
                  onClick={handleDisconnect}
                >
                  {t`Disconnect`}
                </Button>
              ),
            )
            .with(
              { isCurrentConfigured: false },
              { isCurrentConfigured: true, isConnectButtonEnabled: true },
              () => (
                <Button
                  variant="filled"
                  loading={isMutating}
                  disabled={isMutating || !isConnectButtonEnabled}
                  onClick={handleConnect}
                >
                  {t`Connect`}
                </Button>
              ),
            )
            .exhaustive()}
        </Flex>
        <ConfirmModal
          opened={isDisconnectConfirmOpen}
          onClose={() => setIsDisconnectConfirmOpen(false)}
          title={t`Disconnect AI provider?`}
          message={t`This will disconnect your AI provider and disable AI features across your instance until you connect a provider again.`}
          confirmButtonText={t`Disconnect provider`}
          onConfirm={handleConfirmDisconnect}
        />
      </Stack>
    </MetabotSetupContext.Provider>
  );
}

const AIProviderSetup = ({
  selectedProvider,
  connectedModel,
  isCurrentConfigured,
  isEnvSetting,
}: {
  selectedProvider: Exclude<MetabotProvider, "metabase">;
  connectedModel: string | undefined;
  isCurrentConfigured: boolean;
  isEnvSetting: boolean;
}) => {
  const [model, setModel] = useState<string | undefined>(connectedModel);
  const [customAzureDeployments, setCustomAzureDeployments] = useState<string[]>(
    [],
  );
  const [customAzureDeploymentInput, setCustomAzureDeploymentInput] = useState("");
  const [apiKeyLocalValue, setApiKeyLocalValue] = useState<string | null>(null);
  const [azureBaseUrlLocalValue, setAzureBaseUrlLocalValue] = useState<
    string | null
  >(null);
  const [azureApiVersionLocalValue, setAzureApiVersionLocalValue] = useState<
    string | null
  >(null);
  const [sendToast] = useToast();
  const isAzureProvider = selectedProvider === "azure";

  useEffect(() => {
    setModel(connectedModel);
  }, [connectedModel]);

  const [updateSettings] = useUpdateSettingsMutation();
  const [updateMetabotSettings, updateMetabotSettingsResult] =
    useUpdateMetabotSettingsMutation();
  const { details: providerApiKeyDetails } = useAdminSettings([
    "llm-anthropic-api-key",
    "llm-azure-api-base-url",
    "llm-azure-api-key",
    "llm-azure-api-version",
    "llm-openai-api-key",
    "llm-openrouter-api-key",
  ] as const);

  const selectedApiKeySetting =
    providerApiKeyDetails[API_KEY_SETTING_BY_PROVIDER[selectedProvider]];
  const selectedApiKeyValue = String(selectedApiKeySetting?.value ?? "");
  const apiKeyEnvSettingName = selectedApiKeySetting?.is_env_setting
    ? selectedApiKeySetting.env_name
    : undefined;
  const needsApiKey = !hasConfiguredSettingValue(selectedApiKeySetting);
  const selectedAzureBaseUrlSetting = providerApiKeyDetails[
    "llm-azure-api-base-url"
  ];
  const selectedAzureApiVersionSetting = providerApiKeyDetails[
    "llm-azure-api-version"
  ];
  const azureBaseUrl =
    azureBaseUrlLocalValue ?? String(selectedAzureBaseUrlSetting?.value ?? "");
  const azureApiVersion =
    azureApiVersionLocalValue ??
    String(selectedAzureApiVersionSetting?.value ?? DEFAULT_AZURE_API_VERSION);
  const hasDirtyApiKey = apiKeyLocalValue !== null;
  const hasDirtyAzureBaseUrl = azureBaseUrlLocalValue !== null;
  const hasDirtyAzureApiVersion = azureApiVersionLocalValue !== null;
  const hasDirtyAzureModel = isAzureProvider && model !== connectedModel;
  const isAzureConnectValid =
    !isAzureProvider ||
    (Boolean(model) &&
      Boolean(azureBaseUrl.trim()) &&
      (!needsApiKey || Boolean((apiKeyLocalValue ?? "").trim())));

  const onConnect = async () => {
    if (isAzureProvider) {
      await updateSettings({
        "llm-azure-api-base-url": azureBaseUrl,
        "llm-azure-api-version": azureApiVersion,
      }).unwrap();
    }

    await updateMetabotSettings({
      provider: selectedProvider,
      ...(hasDirtyApiKey ? { "api-key": apiKeyLocalValue || null } : {}),
      ...(isAzureProvider && model ? { model } : {}),
    }).unwrap();

    setApiKeyLocalValue(null);
    setAzureBaseUrlLocalValue(null);
    setAzureApiVersionLocalValue(null);
  };

  const connectHandler =
    (!isCurrentConfigured ||
      hasDirtyApiKey ||
      (isAzureProvider &&
        (hasDirtyAzureBaseUrl ||
          hasDirtyAzureApiVersion ||
          hasDirtyAzureModel))) &&
    isAzureConnectValid
      ? onConnect
      : null;

  const { isMutating } = useMetabotSetupContext(connectHandler);

  const metabotSettingsQuery = useGetMetabotSettingsQuery(
    {
      provider: selectedProvider,
    },
    { skip: needsApiKey && !isAzureProvider },
  );

  const modelOptions = useMemo(
    () => getLlmModelOptions(metabotSettingsQuery.currentData?.models ?? []),
    [metabotSettingsQuery.currentData?.models],
  );

  const azureDeploymentOptions = useMemo(() => {
    const deployments = metabotSettingsQuery.currentData?.models ?? [];
    const knownIds = new Set(deployments.map((deployment) => deployment.id));
    const extraDeploymentIds = [...new Set([connectedModel, ...customAzureDeployments])]
      .filter((deployment): deployment is string => Boolean(deployment?.trim()))
      .filter((deployment) => !knownIds.has(deployment));
    const extraDeployments = extraDeploymentIds
      .map((deployment) => ({
        id: deployment,
        display_name: deployment,
        group: CUSTOM_AZURE_DEPLOYMENT_GROUP,
      }));

    return getLlmModelOptions([...deployments, ...extraDeployments]);
  }, [connectedModel, customAzureDeployments, metabotSettingsQuery.currentData?.models]);

  const modelError = getModelError(
    metabotSettingsQuery.error,
    selectedProvider,
  );
  const apiKeyError = hasDirtyApiKey
    ? undefined
    : (metabotSettingsQuery.currentData?.["api-key-error"] ?? undefined);

  const displayApiKeyValue = apiKeyLocalValue ?? selectedApiKeyValue;

  useEffect(() => {
    setApiKeyLocalValue(null);
  }, [selectedProvider, selectedApiKeySetting?.value]);

  useEffect(() => {
    setAzureBaseUrlLocalValue(null);
    setAzureApiVersionLocalValue(null);
    setCustomAzureDeployments([]);
    setCustomAzureDeploymentInput("");
  }, [
    selectedProvider,
    selectedAzureApiVersionSetting?.value,
    selectedAzureBaseUrlSetting?.value,
  ]);

  const handleApiKeyChange = (event: ChangeEvent<HTMLInputElement>) => {
    setApiKeyLocalValue(event.target.value);
  };

  const handleAzureBaseUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    setAzureBaseUrlLocalValue(event.target.value);
  };

  const handleAzureApiVersionChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    setAzureApiVersionLocalValue(event.target.value);
  };

  const handleModelChange = async (value: string) => {
    setModel(value);

    if (!value) {
      return;
    }

    if (selectedProvider === "azure") {
      return;
    }

    await updateMetabotSettings({
      provider: selectedProvider,
      model: value,
    }).unwrap();

    sendToast({
      message: t`Settings saved successfully`,
      icon: "check",
    });
  };

  const addCustomAzureDeployment = (value: string) => {
    const deployment = value.trim();

    if (!deployment) {
      return;
    }

    setCustomAzureDeployments((current) =>
      current.includes(deployment) ? current : [...current, deployment],
    );
    setModel(deployment);
    setCustomAzureDeploymentInput("");
  };

  const handleCustomAzureDeploymentInputChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    setCustomAzureDeploymentInput(event.target.value);
  };

  const handleAddCustomAzureDeployment = () => {
    addCustomAzureDeployment(customAzureDeploymentInput);
  };

  const selectedProviderDetails = getProviderOptions(true)[selectedProvider];

  return (
    <>
      <TextInput
        key={selectedProvider}
        label={t`API key`}
        type="password"
        description={
          <ExternalLink
            key={selectedProviderDetails.value}
            href={selectedProviderDetails.apiKey.addKeyUrl}
          >
            {c("{0} is the name of an AI provider")
              .t`Get or manage keys in ${selectedProviderDetails.label}`}
          </ExternalLink>
        }
        placeholder={
          selectedProviderDetails.apiKey?.placeholder ?? t`Enter your API key`
        }
        value={displayApiKeyValue}
        error={apiKeyError}
        onChange={handleApiKeyChange}
        disabled={isMutating || isEnvSetting || !!apiKeyEnvSettingName}
        w="100%"
      />

      {apiKeyEnvSettingName ? (
        <SetByEnvVar varName={apiKeyEnvSettingName} />
      ) : null}

      {isAzureProvider && (
        <>
          <TextInput
            label={t`Endpoint URL`}
            placeholder={t`https://your-resource.openai.azure.com`}
            description={t`The Azure Foundry endpoint for your deployment.`}
            value={azureBaseUrl}
            onChange={handleAzureBaseUrlChange}
            disabled={isMutating}
            w="100%"
          />

          <TextInput
            label={t`API version`}
            placeholder={DEFAULT_AZURE_API_VERSION}
            description={t`The Azure Foundry API version sent with each request.`}
            value={azureApiVersion}
            onChange={handleAzureApiVersionChange}
            disabled={isMutating}
            w="100%"
          />

          <Select
            label={t`Deployment`}
            placeholder={
              metabotSettingsQuery.isFetching
                ? t`Loading deployments...`
                : t`Select a deployment`
            }
            description={getModelDescription(selectedProvider)}
            error={modelError}
            data={azureDeploymentOptions}
            value={model}
            onChange={handleModelChange}
            disabled={isEnvSetting || isMutating}
            searchable
            nothingFoundMessage={t`No deployments found`}
          />

          <Group align="end" gap="sm">
            <TextInput
              label={t`Custom deployment`}
              placeholder={t`Add a deployment name not shown above`}
              description={t`Use this when your Azure deployment name is not in the suggested list.`}
              value={customAzureDeploymentInput}
              onChange={handleCustomAzureDeploymentInputChange}
              disabled={isEnvSetting || isMutating}
              flex={1}
            />

            <Button
              variant="default"
              onClick={handleAddCustomAzureDeployment}
              disabled={
                isEnvSetting ||
                isMutating ||
                !customAzureDeploymentInput.trim()
              }
            >
              {t`Add deployment`}
            </Button>
          </Group>
        </>
      )}

        {!needsApiKey && !apiKeyError && !isAzureProvider && (
        <Select
          label={t`Model`}
          placeholder={
            metabotSettingsQuery.isLoading
              ? t`Loading models...`
              : t`Select a model`
          }
          description={getModelDescription(selectedProvider)}
          error={modelError}
          data={modelOptions}
          value={model}
          onChange={handleModelChange}
          disabled={isEnvSetting || needsApiKey || isMutating}
          searchable
          nothingFoundMessage={t`No models found`}
        />
      )}

      {updateMetabotSettingsResult.error && (
        <Text size="sm" c="error">
          {getErrorMessage(
            updateMetabotSettingsResult.error,
            t`Unable to save provider settings.`,
          )}
        </Text>
      )}
    </>
  );
};

const getLlmModelOptions = (models: MetabotSettingsResponse["models"]) => {
  const modelOptions = models.map((m) => ({
    value: m.id,
    label: m.display_name,
    group: m.group,
  }));

  const sel = (o: MetabotModelOption) => _.pick(o, ["value", "label"]);
  // group model options if needed
  return _.every(modelOptions, (o) => !o.group)
    ? modelOptions.map(sel)
    : _.map(
        _.groupBy(modelOptions, (o) => o.group ?? t`Other`),
        (items, group) => ({ group, items: items.map(sel) }),
      );
};

const hasConfiguredSettingValue = (setting: SettingDefinition | undefined) =>
  Boolean(setting?.value || setting?.is_env_setting);

const getModelError = (error: unknown, provider?: MetabotProvider) =>
  !provider || !error
    ? undefined
    : getErrorMessage(error, t`Unable to load models.`);
