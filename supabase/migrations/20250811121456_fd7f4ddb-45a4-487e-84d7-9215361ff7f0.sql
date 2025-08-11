-- Enable required extensions for fuzzy string matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- Create GIN indexes for better performance on text search
CREATE INDEX IF NOT EXISTS idx_account_evidence_filename_gin ON account_evidence USING gin(file_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_account_evidence_trial_balance ON account_evidence(trial_balance_id);

-- Create smart document matching function that works on account level
CREATE OR REPLACE FUNCTION smart_match_documents(trial_balance_id_param uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    account_record RECORD;
    document_record RECORD;
    match_found BOOLEAN;
    matched_count INTEGER := 0;
    total_accounts INTEGER := 0;
    balance_patterns TEXT[];
    pattern TEXT;
    confidence NUMERIC;
    has_groups BOOLEAN;
BEGIN
    -- Check if account groups exist
    SELECT COUNT(*) > 0 INTO has_groups
    FROM account_groups 
    WHERE trial_balance_id = trial_balance_id_param;
    
    -- Process all accounts regardless of grouping
    IF has_groups THEN
        -- Work with grouped accounts
        FOR account_record IN
            SELECT 
                aga.id as assignment_id,
                aga.account_number,
                aga.account_name,
                aga.current_year_balance,
                'grouped' as source_type
            FROM account_group_assignments aga
            JOIN account_groups ag ON aga.account_group_id = ag.id
            WHERE ag.trial_balance_id = trial_balance_id_param
            AND aga.current_year_balance != 0  -- Skip zero balances
        LOOP
            total_accounts := total_accounts + 1;
            match_found := FALSE;
            
            -- Generate balance patterns for current year balance
            balance_patterns := ARRAY[
                abs(account_record.current_year_balance)::TEXT,
                replace(abs(account_record.current_year_balance)::TEXT, '.', ','),
                replace(abs(account_record.current_year_balance)::TEXT, '.', ''''),
                to_char(abs(account_record.current_year_balance), 'FM999,999,999.00'),
                to_char(abs(account_record.current_year_balance), 'FM999''999''999.00')
            ];
            
            -- Search through documents for matches
            FOR document_record IN
                SELECT ae.id, ae.file_name, ae.file_path
                FROM account_evidence ae
                WHERE ae.trial_balance_id = trial_balance_id_param
            LOOP
                confidence := 0;
                
                -- Check account number similarity
                IF similarity(account_record.account_number, document_record.file_name) > 0.3 THEN
                    confidence := confidence + 0.4;
                END IF;
                
                -- Check account name similarity  
                IF similarity(account_record.account_name, document_record.file_name) > 0.3 THEN
                    confidence := confidence + 0.3;
                END IF;
                
                -- Check balance patterns in filename
                FOREACH pattern IN ARRAY balance_patterns
                LOOP
                    IF document_record.file_name ILIKE '%' || pattern || '%' THEN
                        confidence := confidence + 0.5;
                        EXIT; -- Found balance match, no need to check other patterns
                    END IF;
                END LOOP;
                
                -- If confidence is high enough, record the match
                IF confidence >= 0.5 THEN
                    UPDATE account_group_assignments
                    SET 
                        match_status = 'matched',
                        confidence_score = confidence,
                        matched_documents = array_append(COALESCE(matched_documents, ARRAY[]::uuid[]), document_record.id)
                    WHERE id = account_record.assignment_id;
                    
                    match_found := TRUE;
                    matched_count := matched_count + 1;
                    EXIT; -- Found a good match, move to next account
                END IF;
            END LOOP;
            
            -- Mark as unmatched if no good match found
            IF NOT match_found THEN
                UPDATE account_group_assignments
                SET match_status = 'unmatched'
                WHERE id = account_record.assignment_id;
            END IF;
        END LOOP;
    ELSE
        -- Work with ungrouped accounts (temp_account_matches)
        FOR account_record IN
            SELECT 
                tam.id as match_id,
                tam.account_number,
                tam.account_name,
                tam.current_year_balance,
                'ungrouped' as source_type
            FROM temp_account_matches tam
            WHERE tam.trial_balance_id = trial_balance_id_param
            AND tam.current_year_balance != 0  -- Skip zero balances
        LOOP
            total_accounts := total_accounts + 1;
            match_found := FALSE;
            
            -- Generate balance patterns for current year balance
            balance_patterns := ARRAY[
                abs(account_record.current_year_balance)::TEXT,
                replace(abs(account_record.current_year_balance)::TEXT, '.', ','),
                replace(abs(account_record.current_year_balance)::TEXT, '.', ''''),
                to_char(abs(account_record.current_year_balance), 'FM999,999,999.00'),
                to_char(abs(account_record.current_year_balance), 'FM999''999''999.00')
            ];
            
            -- Search through documents for matches
            FOR document_record IN
                SELECT ae.id, ae.file_name, ae.file_path
                FROM account_evidence ae
                WHERE ae.trial_balance_id = trial_balance_id_param
            LOOP
                confidence := 0;
                
                -- Check account number similarity
                IF similarity(account_record.account_number, document_record.file_name) > 0.3 THEN
                    confidence := confidence + 0.4;
                END IF;
                
                -- Check account name similarity  
                IF similarity(account_record.account_name, document_record.file_name) > 0.3 THEN
                    confidence := confidence + 0.3;
                END IF;
                
                -- Check balance patterns in filename
                FOREACH pattern IN ARRAY balance_patterns
                LOOP
                    IF document_record.file_name ILIKE '%' || pattern || '%' THEN
                        confidence := confidence + 0.5;
                        EXIT; -- Found balance match, no need to check other patterns
                    END IF;
                END LOOP;
                
                -- If confidence is high enough, record the match
                IF confidence >= 0.5 THEN
                    UPDATE temp_account_matches
                    SET 
                        match_status = 'matched',
                        confidence_score = confidence,
                        matched_documents = array_append(COALESCE(matched_documents, ARRAY[]::uuid[]), document_record.id)
                    WHERE id = account_record.match_id;
                    
                    match_found := TRUE;
                    matched_count := matched_count + 1;
                    EXIT; -- Found a good match, move to next account
                END IF;
            END LOOP;
            
            -- Mark as unmatched if no good match found
            IF NOT match_found THEN
                UPDATE temp_account_matches
                SET match_status = 'unmatched'
                WHERE id = account_record.match_id;
            END IF;
        END LOOP;
    END IF;
    
    RETURN json_build_object(
        'success', true,
        'total_accounts', total_accounts,
        'matched_count', matched_count,
        'has_groups', has_groups,
        'match_rate', CASE WHEN total_accounts > 0 THEN (matched_count::NUMERIC / total_accounts::NUMERIC) * 100 ELSE 0 END
    );
END;
$$;