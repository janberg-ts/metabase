(ns metabase.metabot.self.azure
	"Azure Foundry adapter backed by a local curated model list.

	Azure uses deployment names at request time. For now we assume the deployment
	names match the configured model ids in this local list, which gives us a
	stable selection experience without relying on management-plane discovery."
	(:require
	 [clojure.string :as str]
	 [malli.json-schema :as mjs]
	 [metabase.llm.settings :as llm]
	 [metabase.metabot.self.core :as core]
	 [metabase.metabot.self.debug :as debug]
	 [metabase.metabot.self.openrouter :as openrouter]
	 [metabase.metabot.self.schema :as schema]
	 [metabase.util.i18n :refer [tru]]
	 [metabase.util.json :as json]
	 [metabase.util.malli :as mu]
	 [metabase.util.o11y :refer [with-span]]))

(set! *warn-on-reflection* true)

(def ^:private default-azure-model
	"gpt-5.5")

(def ^:private default-azure-api-version
	"2024-12-01-preview")

(def ^:private curated-models
	[{:id "gpt-5.5"      :display_name "GPT-5.5"      :group "GPT-5"}
	 {:id "gpt-5"        :display_name "GPT-5"        :group "GPT-5"}
	 {:id "gpt-4.1"      :display_name "GPT-4.1"      :group "GPT-4.1"}
	 {:id "gpt-4.1-mini" :display_name "GPT-4.1 mini" :group "GPT-4.1"}
	 {:id "gpt-4o"       :display_name "GPT-4o"       :group "GPT-4o"}
	 {:id "gpt-4o-mini"  :display_name "GPT-4o mini"  :group "GPT-4o"}])

(defn- normalize-base-url
	[base-url]
	(some-> base-url not-empty (str/replace #"/+$" "")))

(defn- missing-base-url-ex []
	(ex-info (tru "Missing Azure Foundry endpoint URL")
					 {:api-error  true
						:error-code :azure-endpoint-missing}))

(defn- azure-errors [res]
	(let [status    (long (:status res 0))
				error-msg (get-in res [:body :error :message])]
		(case status
			401 (tru "Azure Foundry API key expired or invalid")
			403 (tru "Azure Foundry API key has insufficient permissions")
			404 (tru "Azure Foundry endpoint or deployment is unavailable")
			429 (tru "Azure Foundry has rate limited us")
			500 (tru "Azure Foundry returned an internal server error")
			503 (tru "Azure Foundry service is unavailable")
			(if error-msg
				(tru "Azure Foundry API error (HTTP {0}): {1}" status error-msg)
				(tru "Azure Foundry API error (HTTP {0})" status)))))

(defn- resolve-azure-auth
	[{:keys [api-key ai-proxy?]}]
	(if ai-proxy?
		(core/resolve-auth "azure" "Azure Foundry" nil true)
		(let [effective-api-key (or (not-empty api-key)
																(not-empty (llm/llm-azure-api-key)))
					base-url          (normalize-base-url (llm/llm-azure-api-base-url))]
			(when-not base-url
				(throw (missing-base-url-ex)))
			(core/resolve-auth "azure" "Azure Foundry"
												 (when effective-api-key
													 {:url     base-url
														:headers {"api-key" effective-api-key}})
												 false))))

(defn- tool->azure-chat
	[{:keys [tool-name doc schema]}]
	(let [[_:=> [_:cat params] _out] schema
				params     (schema/filter-schema-by-features params)
				doc        (if (str/starts-with? (or doc "") "Inputs: ")
										 (second (str/split doc #"\n\n  " 2))
										 doc)]
		{:type     "function"
		 :function {:name        tool-name
								:description doc
								:parameters  (mjs/transform params {:additionalProperties false})}}))

(defn list-models
	"Return the local curated Azure Foundry model list.

	This intentionally does not perform remote discovery; it is used as a local
	configuration aid until discovery is available."
	([] (list-models {}))
	([_opts]
	 {:models curated-models}))

(mu/defn azure-raw
	"Perform a streaming request to Azure Foundry Chat Completions."
	[{:keys [model system input tools temperature max-tokens tool_choice schema ai-proxy?]
		:or   {model default-azure-model}} :- core/LLMRequestOpts]
	(let [deployment  (or (not-empty model) default-azure-model)
				messages    (cond-> (openrouter/parts->cc-messages input)
											system (as-> msgs (into [{:role "system" :content system}] msgs)))
				all-tools   (or (when schema
													[{:type     "function"
														:function {:name        "structured_output"
																			 :description "Output structured data"
																			 :parameters  schema}}])
												(seq (mapv tool->azure-chat tools)))
				api-version (or (not-empty (llm/llm-azure-api-version))
												default-azure-api-version)
				req         (cond-> {:model          deployment
														 :stream         true
														 :stream_options {:include_usage true}
														 :messages       messages}
											all-tools   (assoc :tools       (vec all-tools)
																				 :tool_choice (cond
																												schema      "required"
																												tool_choice tool_choice
																												:else       "auto"))
											temperature (assoc :temperature temperature)
											max-tokens  (assoc :max_completion_tokens max-tokens))
				request-url (str "/openai/deployments/" deployment
												 "/chat/completions?api-version=" api-version)]
		(with-span :info {:name       :metabot.azure/request
											:model      deployment
											:msg-count  (count input)
											:tool-count (count (or tools []))}
			(try
				(let [auth     (resolve-azure-auth {:ai-proxy? ai-proxy?})
							response (core/request auth
																		 {:method  :post
																			:url     request-url
																			:as      :stream
																			:headers {"Content-Type" "application/json"}
																			:body    (json/encode req)})]
					(-> (core/sse-reducible (:body response))
							(debug/capture-stream {:provider "azure"
																		 :model    deployment
																		 :url      request-url
																		 :request  req})))
				(catch Exception e
					(core/rethrow-api-error! "azure" azure-errors e))))))

(defn azure
	"Call Azure Foundry Chat Completions API, return AISDK stream."
	[& args]
	(let [raw (apply azure-raw args)]
		(eduction (openrouter/openrouter->aisdk-chunks-xf) raw)))
