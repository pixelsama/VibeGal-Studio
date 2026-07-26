//! Parser for the finite expression grammar shared with the TypeScript engine.

#[derive(Clone, Debug, PartialEq)]
enum Token {
    Identifier(String),
    Literal,
    Operator(String),
    LeftParen,
    RightParen,
}

pub(crate) fn parse_expression(source: &str) -> Result<Vec<String>, String> {
    let tokens = tokenize(source)?;
    let mut parser = Parser { tokens, index: 0, reads: vec![] };
    parser.parse_binary(1)?;
    if parser.index != parser.tokens.len() {
        return Err("表达式末尾存在多余内容".to_string());
    }
    parser.reads.sort();
    parser.reads.dedup();
    Ok(parser.reads)
}

/// Rewrite every free reference to `from` into `to`, leaving everything else byte-identical.
///
/// This must be token-aware: a plain string replace would also rewrite occurrences
/// inside string literals (`route == "affection"`) and identifiers that merely
/// contain the old name as a substring (`affection_yuki`). Renaming a variable is
/// only safe if it cannot silently change what a condition means.
pub(crate) fn rename_identifier(source: &str, from: &str, to: &str) -> Result<String, String> {
    let spans = identifier_spans(source)?;
    let mut result = String::with_capacity(source.len());
    let mut cursor = 0;
    for (start, end) in spans {
        if &source[start..end] != from {
            continue;
        }
        result.push_str(&source[cursor..start]);
        result.push_str(to);
        cursor = end;
    }
    result.push_str(&source[cursor..]);
    Ok(result)
}

/// Byte ranges of identifier tokens, in source order. Shares the tokenizer's
/// scanning rules so the two can never disagree about what an identifier is.
fn identifier_spans(source: &str) -> Result<Vec<(usize, usize)>, String> {
    let chars = source.as_bytes();
    let mut spans = vec![];
    let mut index = 0;
    while index < chars.len() {
        let byte = chars[index];
        if byte == b'\'' || byte == b'"' {
            let quote = byte;
            index += 1;
            while index < chars.len() && chars[index] != quote {
                index += if chars[index] == b'\\' && index + 1 < chars.len() { 2 } else { 1 };
            }
            if index >= chars.len() {
                return Err("字符串字面量未闭合".to_string());
            }
            index += 1;
            continue;
        }
        if byte.is_ascii_alphabetic() || byte == b'_' {
            let start = index;
            index += 1;
            while index < chars.len() {
                if chars[index].is_ascii_alphanumeric() || matches!(chars[index], b'_' | b'.') {
                    index += 1;
                } else if chars[index] == b'-'
                    && index + 1 < chars.len()
                    && (chars[index + 1].is_ascii_alphabetic() || chars[index + 1] == b'_')
                {
                    index += 1;
                } else {
                    break;
                }
            }
            if !matches!(&source[start..index], "true" | "false" | "null") {
                spans.push((start, index));
            }
            continue;
        }
        index += 1;
    }
    Ok(spans)
}

fn tokenize(source: &str) -> Result<Vec<Token>, String> {
    let chars = source.as_bytes();
    let mut tokens = vec![];
    let mut index = 0;
    while index < chars.len() {
        let byte = chars[index];
        if byte.is_ascii_whitespace() { index += 1; continue; }
        let remaining = &source[index..];
        let two = remaining.get(..2).unwrap_or(remaining);
        if ["&&", "||", "==", "!=", ">=", "<="].contains(&two) {
            tokens.push(Token::Operator(two.to_string())); index += 2; continue;
        }
        let ch = byte as char;
        if "!><+-*/%".contains(ch) {
            tokens.push(Token::Operator(ch.to_string())); index += 1; continue;
        }
        if ch == '(' { tokens.push(Token::LeftParen); index += 1; continue; }
        if ch == ')' { tokens.push(Token::RightParen); index += 1; continue; }
        if ch == '\'' || ch == '"' {
            let quote = byte; index += 1;
            while index < chars.len() && chars[index] != quote {
                index += if chars[index] == b'\\' && index + 1 < chars.len() { 2 } else { 1 };
            }
            if index >= chars.len() { return Err("字符串字面量未闭合".to_string()); }
            index += 1; tokens.push(Token::Literal); continue;
        }
        if byte.is_ascii_digit() {
            index += 1;
            while index < chars.len() && (chars[index].is_ascii_digit() || chars[index] == b'.') { index += 1; }
            tokens.push(Token::Literal); continue;
        }
        if byte.is_ascii_alphabetic() || byte == b'_' {
            let start = index; index += 1;
            while index < chars.len() {
                if chars[index].is_ascii_alphanumeric() || matches!(chars[index], b'_' | b'.') {
                    index += 1;
                } else if chars[index] == b'-'
                    && index + 1 < chars.len()
                    && (chars[index + 1].is_ascii_alphabetic() || chars[index + 1] == b'_')
                {
                    index += 1;
                } else {
                    break;
                }
            }
            let value = source[start..index].to_string();
            if matches!(value.as_str(), "true" | "false" | "null") { tokens.push(Token::Literal); }
            else { tokens.push(Token::Identifier(value)); }
            continue;
        }
        return Err(format!("不支持的表达式字符，位置 {index}"));
    }
    Ok(tokens)
}

struct Parser { tokens: Vec<Token>, index: usize, reads: Vec<String> }

impl Parser {
    fn parse_binary(&mut self, minimum: u8) -> Result<(), String> {
        self.parse_unary()?;
        loop {
            let Some(Token::Operator(operator)) = self.tokens.get(self.index) else { break };
            if operator == "!" { break; }
            let precedence = precedence(operator).ok_or_else(|| format!("不支持的运算符 {operator}"))?;
            if precedence < minimum { break; }
            self.index += 1;
            self.parse_binary(precedence + 1)?;
        }
        Ok(())
    }

    fn parse_unary(&mut self) -> Result<(), String> {
        if matches!(self.tokens.get(self.index), Some(Token::Operator(op)) if op == "!" || op == "-") {
            self.index += 1;
            return self.parse_unary();
        }
        match self.tokens.get(self.index).cloned() {
            Some(Token::Identifier(name)) => { self.reads.push(name); self.index += 1; Ok(()) }
            Some(Token::Literal) => { self.index += 1; Ok(()) }
            Some(Token::LeftParen) => {
                self.index += 1; self.parse_binary(1)?;
                if !matches!(self.tokens.get(self.index), Some(Token::RightParen)) { return Err("缺少右括号".to_string()); }
                self.index += 1; Ok(())
            }
            _ => Err("表达式需要变量、字面量或括号".to_string()),
        }
    }
}

fn precedence(operator: &str) -> Option<u8> {
    Some(match operator {
        "||" => 1, "&&" => 2, "==" | "!=" => 3,
        ">" | "<" | ">=" | "<=" => 4, "+" | "-" => 5, "*" | "/" | "%" => 6,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_finite_expressions_and_collects_reads() {
        assert_eq!(parse_expression("score + bonus * 2 >= 10 && has_key").unwrap(), vec!["bonus", "has_key", "score"]);
        assert!(parse_expression("globalThis.alert(1)").is_err());
        assert!(parse_expression("score +").is_err());
    }

    #[test]
    fn rename_rewrites_only_free_references() {
        assert_eq!(
            rename_identifier("affection >= 60 && affection_yuki < 3", "affection", "love").unwrap(),
            "love >= 60 && affection_yuki < 3",
        );
    }

    #[test]
    fn rename_leaves_string_literals_alone() {
        assert_eq!(
            rename_identifier("route == \"affection\"", "affection", "love").unwrap(),
            "route == \"affection\"",
        );
    }

    #[test]
    fn rename_preserves_dotted_and_negated_forms() {
        assert_eq!(rename_identifier("!has_key", "has_key", "got_key").unwrap(), "!got_key");
        assert_eq!(
            rename_identifier("a.b + a.bc", "a.b", "x.y").unwrap(),
            "x.y + a.bc",
        );
    }

    #[test]
    fn rename_output_still_parses() {
        let renamed = rename_identifier("score + bonus * 2 >= 10 && has_key", "score", "total").unwrap();
        assert_eq!(parse_expression(&renamed).unwrap(), vec!["bonus", "has_key", "total"]);
    }

    #[test]
    fn matches_shared_expression_corpus() {
        let corpus: serde_json::Value = serde_json::from_str(include_str!("../../../../../contracts/fixtures/expression-corpus.json")).unwrap();
        for case in corpus["valid"].as_array().unwrap() {
            let actual = parse_expression(case["source"].as_str().unwrap()).unwrap();
            let expected = case["reads"].as_array().unwrap().iter().map(|value| value.as_str().unwrap().to_string()).collect::<Vec<_>>();
            assert_eq!(actual, expected);
        }
        for source in corpus["invalid"].as_array().unwrap() {
            assert!(parse_expression(source.as_str().unwrap()).is_err(), "must reject {source}");
        }
    }
}
