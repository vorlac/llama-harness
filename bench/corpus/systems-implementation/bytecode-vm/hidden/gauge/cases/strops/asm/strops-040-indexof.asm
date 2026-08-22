; case strops-040-indexof
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_STR "aaa"
  PUSH_STR "aa"
  INDEXOF
  PRINT
  RET
.end
