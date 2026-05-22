(ns metabase.metabot.tools.sql.common
  "Namespace that aggregates functionality common to tools sql namespaces.

  Those are:
  - `metabot.tools.create-sql-query`,
  - `metabot.tools.edit-sql-query`,
  - `metabot.tools.replace-sql-query`.

  Each of those namespaces define an _operation_:
  - `create-sql-query`,
  - `edit-sql-query`,
  - `replace-sql-query`."
  (:require
   [metabase.lib-be.core :as lib-be]
   [metabase.lib.core :as lib]
   [metabase.metabot.tools.shared :as shared]
   [metabase.metabot.tools.sql.validation :as metabot.tools.sql.validation]
   [metabase.util :as u]
   [metabase.util.i18n :refer [tru]]
   [metabase.util.malli.registry :as mr]))

(mr/def ::action-result
  "Each of the _operations_ performs an _action_ manipulating a query.
  Key of the action result represent
  - query-id :: id of a query stored in the context or memory,
  - query-content :: sql that is a result of an action,
  - query :: query map that wraps the `query-content`,
  - database :: id of the database that query belongs to."
  [:map
   [:query-id {:optional true} :any]
   [:query-content :string]
   [:query :map]
   [:database :int]])

(mr/def ::operation-result
  "Result of an operation as described this ns' docstring. Stores validation result and action result iff validation
  was successful."
  [:map
   [:validation-result ::metabot.tools.sql.validation/validation-result]
   [:action-result {:optional true} ::action-result]])

(defn- maybe-normalize-query
  [query]
  (try
    (lib-be/normalize-query query)
    (catch Exception _
      nil)))

(defn update-query-sql
  "Update a dataset_query map with new SQL content.
  Handles both legacy MBQL (`{:type :native, :native {:query ...}}`) and
  MBQL 5 (`{:stages [{:lib/type :mbql.stage/native, :native ...}]}`) formats,
  including the JSON-serialized MBQL 5 variant where enum values are strings."
  [query new-sql]
  (let [normalized (maybe-normalize-query query)]
    (cond
      (and normalized
           (lib/native-only-query? normalized)
           (string? (not-empty new-sql)))
      (lib/with-native-query normalized new-sql)

      (:native query)
      (assoc-in query [:native :query] new-sql)

      :else
      (throw (ex-info (tru "Unsupported query format")
                      {:agent-error? true})))))

(defn- code-editor-buffer?
  [item]
  (let [type-val (:type item)]
    (= "code_editor"
       (cond
         (keyword? type-val) (name type-val)
         (string? type-val) (u/lower-case-en type-val)
         :else nil))))

(defn current-code-editor-buffer
  "Return the first active code editor buffer from the current metabot context."
  []
  (some->> (shared/current-context)
           :user_is_viewing
           (filter code-editor-buffer?)
           first
           :buffers
           first))

(defn ad-hoc-buffer-query
  "Construct an ad hoc native query map from the active SQL editor buffer."
  []
  (let [buffer (current-code-editor-buffer)
        source (:source buffer)
        sql (:value source)
        db-id (:database_id source)]
    (when (and (string? sql) (not-empty sql) (integer? db-id))
      {:type :native
       :database db-id
       :native {:query sql}})))

(defn resolve-query
  "Resolve a SQL query either from in-memory state by id or from the active code editor buffer."
  [queries-state query-id]
  (let [query-id-str (some-> query-id str)]
    (if-let [query (and query-id-str (get queries-state query-id-str))]
      {:query-id query-id-str
       :query query}
      (when-let [query (ad-hoc-buffer-query)]
        {:query query}))))
