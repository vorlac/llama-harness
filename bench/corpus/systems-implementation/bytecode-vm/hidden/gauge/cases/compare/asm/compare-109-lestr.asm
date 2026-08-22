; case compare-109-lestr
; expect exit=0 stdout="true\n"
.func main arity=0 locals=0
  PUSH_STR ""
  PUSH_STR ""
  LE
  PRINT
  RET
.end
