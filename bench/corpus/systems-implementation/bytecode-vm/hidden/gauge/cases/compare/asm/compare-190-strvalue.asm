; case compare-190-strvalue
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR "ab"
  PUSH_STR "a"
  PUSH_STR "b"
  CONCAT
  EQ
  PRINT
  RET
.end
