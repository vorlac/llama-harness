; case compare-111-lestr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR ""
  PUSH_STR "a"
  LE
  PRINT
  RET
.end
