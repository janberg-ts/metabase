import cx from "classnames";
import { t } from "ttag";

import {
  skipToken,
  useGetDatabaseQuery,
  useListDatabaseSchemasQuery,
} from "metabase/api";
import { TableBrowser } from "metabase/browse/tables/TableBrowser";
import { BrowserCrumbs } from "metabase/common/components/BrowserCrumbs";
import { LoadingAndErrorWrapper } from "metabase/common/components/LoadingAndErrorWrapper";
import CS from "metabase/css/core/index.css";
import { Flex } from "metabase/ui";
import * as Urls from "metabase/urls";

import { BrowseCard } from "../components/BrowseCard";
import S from "../components/BrowseContainer.module.css";
import { BrowseDataHeader } from "../components/BrowseDataHeader";
import { BrowseGrid } from "../components/BrowseGrid";

type BrowseSchemaItem = {
  id: string;
  name: string;
  database: {
    id: number;
  };
};

const getSchemaItems = (
  dbId: number,
  schemas: string[],
): BrowseSchemaItem[] => {
  return schemas.map((schemaName) => ({
    id: `${dbId}:${encodeURIComponent(schemaName)}`,
    name: schemaName,
    database: { id: dbId },
  }));
};

export const BrowseSchemas = ({ params }: { params: any }) => {
  const { slug } = params;
  const dbId = Urls.extractEntityId(slug);

  const {
    data: schemaNames,
    isLoading: isSchemasLoading,
    error: schemasError,
  } = useListDatabaseSchemasQuery(dbId != null ? { id: dbId } : skipToken);

  const {
    data: database,
    isLoading: isDatabaseLoading,
    error: databaseError,
  } = useGetDatabaseQuery(dbId != null ? { id: dbId } : skipToken);

  const schemas =
    dbId != null && schemaNames ? getSchemaItems(dbId, schemaNames) : [];
  const error = schemasError ?? databaseError;
  const isLoading = isSchemasLoading || isDatabaseLoading;

  if (error || isLoading || dbId == null) {
    return <LoadingAndErrorWrapper loading={isLoading} error={error} />;
  }

  return (
    <Flex
      className={S.browseContainer}
      flex={1}
      direction="column"
      wrap="nowrap"
      pt="md"
      data-testid="browse-schemas"
    >
      <BrowseDataHeader />
      <Flex className={S.browseMain} direction="column" wrap="nowrap" flex={1}>
        <Flex maw="64rem" mx="auto" w="100%" direction="column">
          {schemas.length === 1 ? (
            <TableBrowser
              schemas={schemas}
              params={params}
              slug={slug}
              dbId={dbId}
              schemaName={schemas[0].name}
              // hide the schema since there's only one
              showSchemaInHeader={false}
            />
          ) : (
            <>
              <Flex align="center" pt="md" pr="sm" pb="sm">
                <BrowserCrumbs
                  crumbs={[
                    { title: t`Databases`, to: "/browse/databases" },
                    { title: database?.name ?? null },
                  ]}
                />
              </Flex>
              {schemas.length === 0 ? (
                <h2
                  className={cx(CS.full, CS.textCentered, CS.textMedium)}
                >{t`This database doesn't have any tables.`}</h2>
              ) : (
                <BrowseGrid pt="lg">
                  {schemas.map((schema) => (
                    <BrowseCard
                      key={schema.id}
                      title={schema.name}
                      icon="folder"
                      to={`/browse/databases/${dbId}/schema/${encodeURIComponent(
                        schema.name,
                      )}`}
                    />
                  ))}
                </BrowseGrid>
              )}
            </>
          )}
        </Flex>
      </Flex>
    </Flex>
  );
};
